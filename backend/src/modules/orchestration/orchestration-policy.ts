import { ProviderKey } from '@prisma/client';
import type { ProviderAdapterError, ProviderCapabilitySet } from '../providers/provider-types';

const INTERACTIVE_FALLBACK_ORDER: Record<ProviderKey, ProviderKey[]> = {
  [ProviderKey.OPENAI]: [ProviderKey.ANTHROPIC, ProviderKey.GEMINI],
  [ProviderKey.ANTHROPIC]: [ProviderKey.GEMINI],
  [ProviderKey.GEMINI]: [ProviderKey.ANTHROPIC],
  [ProviderKey.NANO_BANANA]: [],
  [ProviderKey.VEO]: [],
};

const RETRYABLE_RETRY_CATEGORIES = new Set(['timeout', 'network', 'service_unavailable']);
const FALLBACK_CATEGORIES = new Set([
  'timeout',
  'network',
  'service_unavailable',
  'rate_limit',
  'region_unavailable',
]);

export function buildFallbackCandidateOrder(primary: ProviderKey) {
  return [primary, ...INTERACTIVE_FALLBACK_ORDER[primary]];
}

export function providerSupportsRequest(
  capabilities: ProviderCapabilitySet,
  input: {
    requiresFileContext?: boolean;
    requiresAsyncJobs?: boolean;
  },
) {
  if (input.requiresFileContext && !capabilities.supportsFiles) {
    return false;
  }

  if (input.requiresAsyncJobs && !capabilities.supportsAsyncJobs) {
    return false;
  }

  return input.requiresAsyncJobs ? capabilities.supportsAsyncJobs : capabilities.supportsText;
}

export function shouldRetryProviderError(error: ProviderAdapterError, attemptNumber: number) {
  return attemptNumber === 0 && error.retryable && RETRYABLE_RETRY_CATEGORIES.has(error.category);
}

export function shouldFallbackProviderError(error: ProviderAdapterError) {
  return error.retryable || FALLBACK_CATEGORIES.has(error.category);
}
