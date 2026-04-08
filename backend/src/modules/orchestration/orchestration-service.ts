import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { getRegisteredProvider } from '../providers/provider-registry';
import type { ProviderCapabilitySet } from '../providers/provider-types';
import type {
  AsyncGenerationJobRequest,
  AsyncGenerationJobResult,
  InteractiveGenerationRequest,
  InteractiveGenerationResult,
  OrchestrationDecision,
  OrchestrationRequest,
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
  const provider = getRegisteredProvider(request.providerKey);
  const decision = decideOrchestration(
    {
      providerKey: request.providerKey,
      preferredMode: 'interactive',
      requiresFileContext: request.requiresFileContext,
    },
    provider.metadata.capabilities,
  );

  if (decision.shouldEnqueueJob) {
    throw new AppError(
      'This provider requires async job execution',
      400,
      'PROVIDER_REQUIRES_ASYNC_JOB',
    );
  }

  const startedAt = Date.now();
  logger.info('provider_execution_started', {
    providerKey: request.providerKey,
    model: request.model,
    executionMode: provider.metadata.executionMode,
    chatId: request.chatId ?? null,
    userId: request.userId ?? null,
  });

  try {
    const result = await provider.adapter.generateResponse({
      providerKey: request.providerKey,
      model: request.model,
      messages: request.messages,
    });
    const latencyMs = Date.now() - startedAt;

    logger.info('provider_execution_completed', {
      providerKey: request.providerKey,
      model: request.model,
      executionMode: provider.metadata.executionMode,
      latencyMs,
      upstreamRequestId: result.upstreamRequestId,
      chatId: request.chatId ?? null,
      userId: request.userId ?? null,
    });

    return {
      ...result,
      decision,
      capabilities: provider.metadata.capabilities,
      latencyMs,
    };
  } catch (error) {
    const classified = provider.adapter.classifyError(error);
    logger.error('provider_execution_failed', {
      providerKey: request.providerKey,
      model: request.model,
      executionMode: provider.metadata.executionMode,
      latencyMs: Date.now() - startedAt,
      errorCode: classified.code,
      errorCategory: classified.category,
      retryable: classified.retryable,
      upstreamStatus: classified.upstreamStatus ?? null,
      upstreamRequestId: classified.upstreamRequestId ?? null,
      chatId: request.chatId ?? null,
      userId: request.userId ?? null,
    });
    throw classified;
  }
}

export async function executeAsyncGenerationJob(
  request: AsyncGenerationJobRequest,
): Promise<AsyncGenerationJobResult> {
  const provider = getRegisteredProvider(request.providerKey);
  const decision = decideOrchestration(
    {
      providerKey: request.providerKey,
      preferredMode: 'async_job',
    },
    provider.metadata.capabilities,
  );

  if (!decision.shouldEnqueueJob) {
    throw new AppError(
      'This provider does not require async job execution',
      400,
      'PROVIDER_DOES_NOT_REQUIRE_ASYNC_JOB',
    );
  }

  if (!provider.adapter.executeAsyncJob) {
    throw new AppError(
      'Async job execution is not implemented for this provider',
      501,
      'PROVIDER_ASYNC_JOB_NOT_IMPLEMENTED',
    );
  }

  const startedAt = Date.now();
  logger.info('provider_async_job_started', {
    providerKey: request.providerKey,
    model: request.model,
    kind: request.kind,
    chatId: request.chatId ?? null,
    userId: request.userId ?? null,
  });

  try {
    const result = await provider.adapter.executeAsyncJob({
      providerKey: request.providerKey,
      jobId: request.jobId,
      kind: request.kind,
      model: request.model,
      prompt: request.prompt,
      chatId: request.chatId,
      userId: request.userId,
      metadata: request.metadata,
    });
    const latencyMs = Date.now() - startedAt;

    logger.info('provider_async_job_completed', {
      providerKey: request.providerKey,
      model: request.model,
      kind: request.kind,
      latencyMs,
      upstreamRequestId: result.upstreamRequestId,
      externalJobId: result.externalJobId,
      chatId: request.chatId ?? null,
      userId: request.userId ?? null,
    });

    return {
      ...result,
      decision,
      capabilities: provider.metadata.capabilities,
      latencyMs,
    };
  } catch (error) {
    const classified = provider.adapter.classifyError(error);
    logger.error('provider_async_job_failed', {
      providerKey: request.providerKey,
      model: request.model,
      kind: request.kind,
      latencyMs: Date.now() - startedAt,
      errorCode: classified.code,
      errorCategory: classified.category,
      retryable: classified.retryable,
      upstreamStatus: classified.upstreamStatus ?? null,
      upstreamRequestId: classified.upstreamRequestId ?? null,
      chatId: request.chatId ?? null,
      userId: request.userId ?? null,
    });
    throw classified;
  }
}
