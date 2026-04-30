import {
  GenerationJobStatus,
  type FileAsset,
  type GenerationJob,
  type Prisma,
  type Provider,
} from '@prisma/client';
import os from 'node:os';
import { env } from '../../env';
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
  claimGenerationJobById,
  claimNextGenerationJob,
  completeGenerationJob,
  failGenerationJob,
  getGenerationJobForExecution,
  getGenerationJobTokenCost,
  heartbeatGenerationJob,
  repairStaleGenerationJobs,
} from './jobs-service';

type ClaimedGenerationJob = GenerationJob & {
  provider: Provider;
};

const defaultClaimOwner =
  env.JOB_WORKER_CLAIM_OWNER ?? `backend-job-worker:${os.hostname()}:${process.pid}`;

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

export async function runGenerationJob(
  jobId: string,
  options?: {
    claimOwner?: string;
    claimedJob?: ClaimedGenerationJob;
  },
) {
  const claimOwner = options?.claimOwner ?? defaultClaimOwner;
  const runningJob =
    options?.claimedJob ?? (await claimGenerationJobById(jobId, claimOwner));
  if (!runningJob) {
    logger.info('generation_job_run_skipped', {
      jobId,
      reason: 'not_claimable',
      claimOwner,
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
    claimOwner,
  });

  try {
    await heartbeatGenerationJob(runningJob.id, claimOwner);

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
    if (
      !currentJob ||
      currentJob.status !== GenerationJobStatus.RUNNING ||
      currentJob.claimOwner !== claimOwner
    ) {
      logger.info('generation_job_run_aborted', {
        jobId,
        reason: currentJob ? 'lease_lost_after_execution' : 'deleted_after_execution',
        claimOwner,
      });
      return;
    }

    await heartbeatGenerationJob(runningJob.id, claimOwner);

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
      claimOwner,
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

    const completedJob = await getGenerationJobForExecution(runningJob.id);
    if (completedJob?.status !== GenerationJobStatus.COMPLETED) {
      logger.info('generation_job_completion_skipped', {
        jobId: runningJob.id,
        providerKey: runningJob.provider.key,
        reason: 'terminal_update_not_applied',
        claimOwner,
      });
      return;
    }

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
      claimOwner,
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
      claimOwner,
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
    const failedJob = await getGenerationJobForExecution(jobId);
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
      claimOwner,
      terminalStatus: failedJob?.status ?? null,
      errorMessage:
        error instanceof ProviderAdapterError
          ? 'Provider request failed'
          : error instanceof Error
            ? error.message
            : 'unknown',
    });
  }
}

export async function runGenerationJobWorkerOnce(input?: {
  claimOwner?: string;
  batchSize?: number;
}) {
  const claimOwner = input?.claimOwner ?? defaultClaimOwner;
  const batchSize = input?.batchSize ?? env.JOB_WORKER_BATCH_SIZE;
  const staleRepair = await repairStaleGenerationJobs({ batchSize });
  let claimed = 0;

  for (let index = 0; index < batchSize; index += 1) {
    const job = await claimNextGenerationJob(claimOwner);
    if (!job) {
      break;
    }

    claimed += 1;
    await runGenerationJob(job.id, {
      claimOwner,
      claimedJob: job,
    });
  }

  return {
    claimOwner,
    claimed,
    staleRepair,
  };
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

export async function startGenerationJobWorkerLoop(input?: {
  claimOwner?: string;
  pollIntervalMs?: number;
  batchSize?: number;
  signal?: AbortSignal;
}) {
  const claimOwner = input?.claimOwner ?? defaultClaimOwner;
  const pollIntervalMs = input?.pollIntervalMs ?? env.JOB_WORKER_POLL_INTERVAL_MS;
  const batchSize = input?.batchSize ?? env.JOB_WORKER_BATCH_SIZE;

  logger.info('generation_job_worker_started', {
    claimOwner,
    pollIntervalMs,
    batchSize,
    queueDriver: env.JOB_QUEUE_DRIVER,
  });

  while (!input?.signal?.aborted) {
    try {
      await runGenerationJobWorkerOnce({
        claimOwner,
        batchSize,
      });
    } catch (error) {
      logger.error('generation_job_worker_iteration_failed', {
        claimOwner,
        message: error instanceof Error ? error.message : 'unknown',
        stack: error instanceof Error ? (error.stack ?? null) : null,
      });
    }

    await delay(pollIntervalMs, input?.signal);
  }

  logger.info('generation_job_worker_stopped', { claimOwner });
}
