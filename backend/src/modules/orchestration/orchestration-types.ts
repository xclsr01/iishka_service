import type { GenerationJobKind, ProviderKey } from '@prisma/client';
import type {
  ProviderErrorCategory,
  ProviderAsyncJobResult,
  ProviderCapabilitySet,
  ProviderChatMessage,
  ProviderGenerateResult,
} from '../providers/provider-types';

export type ProviderExecutionMode = 'interactive' | 'async_job';

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

export type ProviderExecutionAttempt = {
  providerKey: ProviderKey;
  model: string;
  status: 'succeeded' | 'failed';
  isFallback: boolean;
  retryCount: number;
  errorCode?: string;
  errorCategory?: ProviderErrorCategory;
  retryable?: boolean;
  upstreamStatus?: number | null;
  upstreamRequestId?: string | null;
};

export type InteractiveGenerationRequest = {
  providerKey: ProviderKey;
  model: string;
  messages: ProviderChatMessage[];
  requiresFileContext?: boolean;
  chatId?: string;
  userId?: string;
};

export type InteractiveGenerationResult = ProviderGenerateResult & {
  decision: OrchestrationDecision;
  capabilities: ProviderCapabilitySet;
  latencyMs: number;
  providerKey: ProviderKey;
  model: string;
  fallbackUsed: boolean;
  attempts: ProviderExecutionAttempt[];
};

export type AsyncGenerationJobRequest = {
  providerKey: ProviderKey;
  jobId: string;
  kind: GenerationJobKind;
  model: string;
  prompt: string;
  chatId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
};

export type AsyncGenerationJobResult = ProviderAsyncJobResult & {
  decision: OrchestrationDecision;
  capabilities: ProviderCapabilitySet;
  latencyMs: number;
  providerKey: ProviderKey;
  model: string;
  fallbackUsed: boolean;
  attempts: ProviderExecutionAttempt[];
};
