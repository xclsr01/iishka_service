import { AppError } from '../../lib/errors';
import type {
  OrchestrationDecision,
  OrchestrationRequest,
  ProviderCapabilitySet,
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
