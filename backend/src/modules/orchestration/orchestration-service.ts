import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { getProviderRuntimeModel, getRegisteredProvider } from '../providers/provider-registry';
import { ProviderAdapterError } from '../providers/provider-types';
import type { ProviderCapabilitySet } from '../providers/provider-types';
import {
  buildFallbackCandidateOrder,
  providerSupportsRequest,
  shouldFallbackProviderError,
  shouldRetryProviderError,
} from './orchestration-policy';
import type {
  AsyncGenerationJobRequest,
  AsyncGenerationJobResult,
  InteractiveGenerationRequest,
  InteractiveGenerationResult,
  OrchestrationDecision,
  OrchestrationRequest,
  ProviderExecutionAttempt,
  ProviderExecutionMode,
} from './orchestration-types';

function resolveRequestedMode(
  preferredMode: ProviderExecutionMode | undefined,
  capabilities: ProviderCapabilitySet,
) {
  if (preferredMode === 'async_job') {
    if (!capabilities.supportsAsyncJobs) {
      throw new AppError('Provider does not support async jobs', 400, 'PROVIDER_MODE_UNSUPPORTED');
    }

    return 'async_job';
  }

  if (preferredMode === 'interactive') {
    return 'interactive';
  }

  return capabilities.supportsAsyncJobs ? 'interactive' : 'interactive';
}

export function decideOrchestration(
  request: OrchestrationRequest,
  capabilities: ProviderCapabilitySet,
): OrchestrationDecision {
  if (request.requiresFileContext && !capabilities.supportsFiles) {
    throw new AppError(
      'Provider does not support file context',
      400,
      'PROVIDER_FILE_SUPPORT_UNAVAILABLE',
    );
  }

  const mode = resolveRequestedMode(request.preferredMode, capabilities);

  return {
    providerKey: request.providerKey,
    mode,
    shouldEnqueueJob: mode === 'async_job',
  };
}

export async function executeInteractiveGeneration(
  request: InteractiveGenerationRequest,
): Promise<InteractiveGenerationResult> {
  const requestedProvider = getRegisteredProvider(request.providerKey);
  const decision = decideOrchestration(
    {
      providerKey: request.providerKey,
      preferredMode: 'interactive',
      requiresFileContext: request.requiresFileContext,
    },
    requestedProvider.metadata.capabilities,
  );

  if (decision.shouldEnqueueJob) {
    throw new AppError(
      'This provider requires async job execution',
      400,
      'PROVIDER_REQUIRES_ASYNC_JOB',
    );
  }

  const startedAt = Date.now();
  const attempts: ProviderExecutionAttempt[] = [];
  const candidateKeys = buildFallbackCandidateOrder(request.providerKey).filter((providerKey, index, all) => {
    if (all.indexOf(providerKey) !== index) {
      return false;
    }

    const candidate = getRegisteredProvider(providerKey);
    return providerSupportsRequest(candidate.metadata.capabilities, {
      requiresFileContext: request.requiresFileContext,
    });
  });

  let lastError: ProviderAdapterError | null = null;

  for (let providerIndex = 0; providerIndex < candidateKeys.length; providerIndex += 1) {
    const candidateKey = candidateKeys[providerIndex];
    const provider = getRegisteredProvider(candidateKey);
    const model = candidateKey === request.providerKey ? request.model : getProviderRuntimeModel(candidateKey);
    const isFallback = providerIndex > 0;

    for (let retryCount = 0; retryCount <= 1; retryCount += 1) {
      logger.info('provider_execution_started', {
        providerKey: candidateKey,
        requestedProviderKey: request.providerKey,
        model,
        executionMode: provider.metadata.executionMode,
        chatId: request.chatId ?? null,
        userId: request.userId ?? null,
        isFallback,
        retryCount,
      });

      try {
        const result = await provider.adapter.generateResponse({
          providerKey: candidateKey,
          model,
          messages: request.messages,
        });
        const latencyMs = Date.now() - startedAt;

        attempts.push({
          providerKey: candidateKey,
          model,
          status: 'succeeded',
          isFallback,
          retryCount,
          upstreamRequestId: result.upstreamRequestId,
        });

        logger.info('provider_execution_completed', {
          providerKey: candidateKey,
          requestedProviderKey: request.providerKey,
          model,
          executionMode: provider.metadata.executionMode,
          latencyMs,
          upstreamRequestId: result.upstreamRequestId,
          chatId: request.chatId ?? null,
          userId: request.userId ?? null,
          isFallback,
          retryCount,
          fallbackUsed: attempts.some((attempt) => attempt.isFallback && attempt.status === 'succeeded'),
        });

        return {
          ...result,
          decision,
          capabilities: provider.metadata.capabilities,
          latencyMs,
          providerKey: candidateKey,
          model,
          fallbackUsed: isFallback,
          attempts,
        };
      } catch (error) {
        const classified = provider.adapter.classifyError(error);
        lastError = classified;
        attempts.push({
          providerKey: candidateKey,
          model,
          status: 'failed',
          isFallback,
          retryCount,
          errorCode: classified.code,
          errorCategory: classified.category,
          retryable: classified.retryable,
          upstreamStatus: classified.upstreamStatus ?? null,
          upstreamRequestId: classified.upstreamRequestId ?? null,
        });
        logger.error('provider_execution_failed', {
          providerKey: candidateKey,
          requestedProviderKey: request.providerKey,
          model,
          executionMode: provider.metadata.executionMode,
          latencyMs: Date.now() - startedAt,
          errorCode: classified.code,
          errorCategory: classified.category,
          retryable: classified.retryable,
          upstreamStatus: classified.upstreamStatus ?? null,
          upstreamRequestId: classified.upstreamRequestId ?? null,
          chatId: request.chatId ?? null,
          userId: request.userId ?? null,
          isFallback,
          retryCount,
        });

        if (shouldRetryProviderError(classified, retryCount)) {
          logger.info('provider_execution_retry_scheduled', {
            providerKey: candidateKey,
            requestedProviderKey: request.providerKey,
            model,
            chatId: request.chatId ?? null,
            userId: request.userId ?? null,
            retryCount: retryCount + 1,
            errorCode: classified.code,
            errorCategory: classified.category,
          });
          continue;
        }

        if (providerIndex < candidateKeys.length - 1 && shouldFallbackProviderError(classified)) {
          logger.info('provider_execution_fallback_selected', {
            fromProviderKey: candidateKey,
            toProviderKey: candidateKeys[providerIndex + 1],
            requestedProviderKey: request.providerKey,
            chatId: request.chatId ?? null,
            userId: request.userId ?? null,
            errorCode: classified.code,
            errorCategory: classified.category,
          });
        }

        break;
      }
    }
  }

  throw lastError ?? new AppError('Provider execution failed', 502, 'PROVIDER_REQUEST_FAILED');
}

export async function executeAsyncGenerationJob(
  request: AsyncGenerationJobRequest,
): Promise<AsyncGenerationJobResult> {
  const requestedProvider = getRegisteredProvider(request.providerKey);
  const decision = decideOrchestration(
    {
      providerKey: request.providerKey,
      preferredMode: 'async_job',
    },
    requestedProvider.metadata.capabilities,
  );

  if (!decision.shouldEnqueueJob) {
    throw new AppError(
      'This provider does not require async job execution',
      400,
      'PROVIDER_DOES_NOT_REQUIRE_ASYNC_JOB',
    );
  }

  const startedAt = Date.now();
  const attempts: ProviderExecutionAttempt[] = [];
  const candidateKeys = buildFallbackCandidateOrder(request.providerKey).filter((providerKey, index, all) => {
    if (all.indexOf(providerKey) !== index) {
      return false;
    }

    const candidate = getRegisteredProvider(providerKey);
    return (
      !!candidate.adapter.executeAsyncJob &&
      providerSupportsRequest(candidate.metadata.capabilities, {
        requiresAsyncJobs: true,
      })
    );
  });

  let lastError: ProviderAdapterError | null = null;

  for (let providerIndex = 0; providerIndex < candidateKeys.length; providerIndex += 1) {
    const candidateKey = candidateKeys[providerIndex];
    const provider = getRegisteredProvider(candidateKey);
    const model = candidateKey === request.providerKey ? request.model : getProviderRuntimeModel(candidateKey);
    const isFallback = providerIndex > 0;

    if (!provider.adapter.executeAsyncJob) {
      continue;
    }

    for (let retryCount = 0; retryCount <= 1; retryCount += 1) {
      logger.info('provider_async_job_started', {
        providerKey: candidateKey,
        requestedProviderKey: request.providerKey,
        model,
        kind: request.kind,
        chatId: request.chatId ?? null,
        userId: request.userId ?? null,
        isFallback,
        retryCount,
      });

      try {
        const result = await provider.adapter.executeAsyncJob({
          providerKey: candidateKey,
          jobId: request.jobId,
          kind: request.kind,
          model,
          prompt: request.prompt,
          chatId: request.chatId,
          userId: request.userId,
          metadata: request.metadata,
        });
        const latencyMs = Date.now() - startedAt;

        attempts.push({
          providerKey: candidateKey,
          model,
          status: 'succeeded',
          isFallback,
          retryCount,
          upstreamRequestId: result.upstreamRequestId,
        });

        logger.info('provider_async_job_completed', {
          providerKey: candidateKey,
          requestedProviderKey: request.providerKey,
          model,
          kind: request.kind,
          latencyMs,
          upstreamRequestId: result.upstreamRequestId,
          externalJobId: result.externalJobId,
          chatId: request.chatId ?? null,
          userId: request.userId ?? null,
          isFallback,
          retryCount,
          fallbackUsed: attempts.some((attempt) => attempt.isFallback && attempt.status === 'succeeded'),
        });

        return {
          ...result,
          decision,
          capabilities: provider.metadata.capabilities,
          latencyMs,
          providerKey: candidateKey,
          model,
          fallbackUsed: isFallback,
          attempts,
        };
      } catch (error) {
        const classified = provider.adapter.classifyError(error);
        lastError = classified;
        attempts.push({
          providerKey: candidateKey,
          model,
          status: 'failed',
          isFallback,
          retryCount,
          errorCode: classified.code,
          errorCategory: classified.category,
          retryable: classified.retryable,
          upstreamStatus: classified.upstreamStatus ?? null,
          upstreamRequestId: classified.upstreamRequestId ?? null,
        });

        logger.error('provider_async_job_failed', {
          providerKey: candidateKey,
          requestedProviderKey: request.providerKey,
          model,
          kind: request.kind,
          latencyMs: Date.now() - startedAt,
          errorCode: classified.code,
          errorCategory: classified.category,
          retryable: classified.retryable,
          upstreamStatus: classified.upstreamStatus ?? null,
          upstreamRequestId: classified.upstreamRequestId ?? null,
          chatId: request.chatId ?? null,
          userId: request.userId ?? null,
          isFallback,
          retryCount,
        });

        if (shouldRetryProviderError(classified, retryCount)) {
          logger.info('provider_async_job_retry_scheduled', {
            providerKey: candidateKey,
            requestedProviderKey: request.providerKey,
            model,
            kind: request.kind,
            retryCount: retryCount + 1,
            errorCode: classified.code,
            errorCategory: classified.category,
            chatId: request.chatId ?? null,
            userId: request.userId ?? null,
          });
          continue;
        }

        if (providerIndex < candidateKeys.length - 1 && shouldFallbackProviderError(classified)) {
          logger.info('provider_async_job_fallback_selected', {
            fromProviderKey: candidateKey,
            toProviderKey: candidateKeys[providerIndex + 1],
            requestedProviderKey: request.providerKey,
            kind: request.kind,
            errorCode: classified.code,
            errorCategory: classified.category,
            chatId: request.chatId ?? null,
            userId: request.userId ?? null,
          });
        }

        break;
      }
    }
  }

  throw lastError ?? new AppError('Provider async job failed', 502, 'PROVIDER_REQUEST_FAILED');
}
