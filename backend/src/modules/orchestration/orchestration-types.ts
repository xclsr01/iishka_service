import type { GenerationJobKind, ProviderKey } from '@prisma/client';
import type {
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
};
