import type { ProviderKey } from '@prisma/client';

export type ProviderExecutionMode = 'interactive' | 'async_job';

export type ProviderCapabilitySet = {
  supportsText: boolean;
  supportsImage: boolean;
  supportsStreaming: boolean;
  supportsAsyncJobs: boolean;
  supportsFiles: boolean;
};

export type OrchestrationRequest = {
  providerKey: ProviderKey;
  preferredMode?: ProviderExecutionMode;
  requiresFileContext?: boolean;
};

export type OrchestrationDecision = {
  providerKey: ProviderKey;
  mode: ProviderExecutionMode;
  shouldEnqueueJob: boolean;
};
