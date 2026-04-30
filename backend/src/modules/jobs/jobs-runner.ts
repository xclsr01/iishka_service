import {
  GenerationJobStatus,
  type FileAsset,
  type Prisma,
} from '@prisma/client';
import { logger } from '../../lib/logger';
import { persistGeneratedFile } from '../files/file-service';
import { executeAsyncGenerationJob } from '../orchestration/orchestration-service';
import {
  providerErrorLogMeta,
  toClientSafeProviderMessage,
} from '../providers/provider-error-mapping';
import type { ProviderGeneratedFileArtifact } from '../providers/provider-types';
import { ProviderAdapterError } from '../providers/provider-types';
import { consumeSubscriptionTokens } from '../subscriptions/subscription-service';
import { persistProviderUsage } from '../usage/usage-service';
import {
  buildAsyncMessageProviderMeta,
  completeGenerationJob,
  failGenerationJob,
  getGenerationJobForExecution,
  getGenerationJobTokenCost,
  markGenerationJobRunning,
} from './jobs-service';

function toMetadataObject(
  value: Prisma.JsonValue | null,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function getSourceUserMessageId(value: Prisma.JsonValue | null) {
  const metadata = toMetadataObject(value);
  return typeof metadata?.sourceUserMessageId === 'string'
    ? metadata.sourceUserMessageId
    : null;
}

function getLinkedMessageId(value: Prisma.JsonValue | null) {
  const metadata = toMetadataObject(value);
  return typeof metadata?.linkedMessageId === 'string'
    ? metadata.linkedMessageId
    : null;
}

async function persistGeneratedArtifacts(
  userId: string,
  artifacts?: ProviderGeneratedFileArtifact[],
): Promise<FileAsset[]> {
  if (!artifacts || artifacts.length === 0) {
    return [];
  }

  const files: FileAsset[] = [];
  for (const artifact of artifacts) {
    files.push(
      await persistGeneratedFile({
        userId,
        filename: artifact.filename,
        mimeType: artifact.mimeType,
        bytes: artifact.bytes,
      }),
    );
  }

  return files;
}

function injectPersistedFilesIntoResultPayload(
  resultPayload: Record<string, unknown>,
  files: FileAsset[],
) {
  const candidate = { ...resultPayload } as Record<string, unknown>;

  if (Array.isArray(candidate.videos)) {
    candidate.videos = candidate.videos.map((video, index) => {
      if (!video || typeof video !== 'object') {
        return video;
      }

      const file = files[index];
      return {
        ...(video as Record<string, unknown>),
        fileId: file?.id ?? null,
      };
    });
  }

  return candidate;
}

export async function runGenerationJob(jobId: string) {
  const runningJob = await markGenerationJobRunning(jobId);
  if (!runningJob) {
    logger.info('generation_job_run_skipped', {
      jobId,
      reason: 'not_queued',
    });
    return;
  }

  logger.info('generation_job_run_started', {
    jobId: runningJob.id,
    providerKey: runningJob.provider.key,
    kind: runningJob.kind,
    userId: runningJob.userId,
    chatId: runningJob.chatId ?? null,
    attemptCount: runningJob.attemptCount,
  });

  try {
    const result = await executeAsyncGenerationJob({
      jobId: runningJob.id,
      providerKey: runningJob.provider.key,
      kind: runningJob.kind,
      model: runningJob.provider.defaultModel,
      prompt: runningJob.prompt,
      chatId: runningJob.chatId ?? undefined,
      userId: runningJob.userId,
      metadata: toMetadataObject(runningJob.metadata),
    });

    const currentJob = await getGenerationJobForExecution(jobId);
    if (!currentJob) {
      logger.info('generation_job_run_aborted', {
        jobId,
        reason: 'deleted_after_execution',
      });
      return;
    }

    await consumeSubscriptionTokens(
      runningJob.userId,
      getGenerationJobTokenCost(runningJob.kind),
    );

    const attachedFiles = await persistGeneratedArtifacts(
      runningJob.userId,
      result.artifacts,
    );
    const persistedResultPayload = injectPersistedFilesIntoResultPayload(
      result.resultPayload,
      attachedFiles,
    );
    const sourceUserMessageId = getSourceUserMessageId(currentJob.metadata);
    const linkedMessageId = getLinkedMessageId(currentJob.metadata);

    await completeGenerationJob({
      jobId: runningJob.id,
      resultPayload: persistedResultPayload as Prisma.InputJsonValue,
      providerRequestId: result.upstreamRequestId,
      externalJobId: result.externalJobId,
      messageId: linkedMessageId,
      attachedFiles,
      messageProviderMeta: linkedMessageId
        ? buildAsyncMessageProviderMeta({
            requestedProviderKey: currentJob.provider.key,
            requestedModel: runningJob.provider.defaultModel,
            jobId: runningJob.id,
            jobKind: runningJob.kind,
            prompt: runningJob.prompt,
            status: GenerationJobStatus.COMPLETED,
            sourceUserMessageId,
            upstreamRequestId: result.upstreamRequestId,
            externalJobId: result.externalJobId,
            resultPayload: persistedResultPayload,
          })
        : undefined,
    });

    await persistProviderUsage({
      userId: runningJob.userId,
      providerId: runningJob.providerId,
      chatId: runningJob.chatId ?? null,
      generationJobId: runningJob.id,
      operation: 'JOB_GENERATION',
      model: runningJob.provider.defaultModel,
      upstreamRequestId: result.upstreamRequestId,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      totalTokens: result.usage?.totalTokens ?? null,
      requestUnits: result.usage?.requestUnits ?? null,
      latencyMs: result.latencyMs,
      metadata: {
        executionMode: result.decision.mode,
        capabilities: result.capabilities,
        externalJobId: result.externalJobId,
        rawUsage: result.usage?.raw ?? null,
      },
    }).catch((error) => {
      logger.error('provider_usage_record_failed', {
        jobId: runningJob.id,
        providerKey: runningJob.provider.key,
        message: error instanceof Error ? error.message : 'unknown',
      });
    });

    logger.info('generation_job_run_completed', {
      jobId: runningJob.id,
      providerKey: runningJob.provider.key,
      kind: runningJob.kind,
      upstreamRequestId: result.upstreamRequestId,
      externalJobId: result.externalJobId,
    });
  } catch (error) {
    const currentJob = await getGenerationJobForExecution(jobId);
    if (!currentJob) {
      logger.info('generation_job_run_aborted', {
        jobId,
        reason: 'deleted',
        message: error instanceof Error ? error.message : 'unknown',
      });
      return;
    }

    const registeredProviderKey = currentJob.provider.key;
    const failureCode =
      error instanceof Error && 'code' in error
        ? String(error.code)
        : 'JOB_EXECUTION_FAILED';
    const failureMessage =
      error instanceof ProviderAdapterError
        ? toClientSafeProviderMessage(error)
        : 'Generation job failed';
    const sourceUserMessageId = getSourceUserMessageId(currentJob.metadata);
    const linkedMessageId = getLinkedMessageId(currentJob.metadata);

    await failGenerationJob({
      jobId,
      failureCode,
      failureMessage,
      providerRequestId:
        error instanceof ProviderAdapterError
          ? (error.upstreamRequestId ?? null)
          : null,
      messageId: linkedMessageId,
      messageProviderMeta: linkedMessageId
        ? buildAsyncMessageProviderMeta({
            requestedProviderKey: currentJob.provider.key,
            requestedModel: currentJob.provider.defaultModel,
            jobId,
            jobKind: currentJob.kind,
            prompt: currentJob.prompt,
            status: GenerationJobStatus.FAILED,
            sourceUserMessageId,
            upstreamRequestId:
              error instanceof ProviderAdapterError
                ? (error.upstreamRequestId ?? null)
                : null,
            externalJobId: null,
            failureCode,
            failureMessage,
          })
        : undefined,
    });

    const providerMeta =
      error instanceof ProviderAdapterError
        ? providerErrorLogMeta(error)
        : null;
    logger.error('generation_job_run_failed', {
      jobId,
      providerKey: registeredProviderKey,
      failureCode,
      failureMessage,
      providerErrorCode: providerMeta?.providerErrorCode ?? null,
      upstreamRequestId: providerMeta?.upstreamRequestId ?? null,
      upstreamStatus: providerMeta?.upstreamStatus ?? null,
      errorCategory: providerMeta?.errorCategory ?? null,
      retryable: providerMeta?.retryable ?? null,
      errorMessage:
        error instanceof ProviderAdapterError
          ? 'Provider request failed'
          : error instanceof Error
            ? error.message
            : 'unknown',
    });
  }
}
