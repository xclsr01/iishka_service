import type { Prisma } from '@prisma/client';
import { logger } from '../../lib/logger';
import { executeAsyncGenerationJob } from '../orchestration/orchestration-service';
import { toClientSafeProviderMessage } from '../providers/provider-error-mapping';
import { ProviderAdapterError } from '../providers/provider-types';
import { consumeSubscriptionTokens } from '../subscriptions/subscription-service';
import { persistProviderUsage } from '../usage/usage-service';
import {
  completeGenerationJob,
  failGenerationJob,
  getGenerationJobForExecution,
  getGenerationJobTokenCost,
  markGenerationJobRunning,
} from './jobs-service';

function toMetadataObject(value: Prisma.JsonValue | null): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
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

    await consumeSubscriptionTokens(runningJob.userId, getGenerationJobTokenCost(runningJob.kind));

    await completeGenerationJob({
      jobId: runningJob.id,
      resultPayload: result.resultPayload as Prisma.InputJsonValue,
      providerRequestId: result.upstreamRequestId,
      externalJobId: result.externalJobId,
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
    const registeredProviderKey = currentJob.provider.key;
    const failureCode = error instanceof Error && 'code' in error ? String(error.code) : 'JOB_EXECUTION_FAILED';
    const failureMessage =
      error instanceof ProviderAdapterError
        ? toClientSafeProviderMessage(error)
        : error instanceof Error
          ? error.message
          : 'Generation job failed';

    await failGenerationJob({
      jobId,
      failureCode,
      failureMessage,
      providerRequestId: error instanceof ProviderAdapterError ? error.upstreamRequestId ?? null : null,
    });

    logger.error('generation_job_run_failed', {
      jobId,
      providerKey: registeredProviderKey,
      failureCode,
      failureMessage,
      upstreamRequestId: error instanceof ProviderAdapterError ? error.upstreamRequestId ?? null : null,
      upstreamStatus: error instanceof ProviderAdapterError ? error.upstreamStatus ?? null : null,
      retryable: error instanceof ProviderAdapterError ? error.retryable : null,
      message: error instanceof Error ? error.message : 'unknown',
      stack: error instanceof Error ? error.stack ?? null : null,
    });
  }
}
