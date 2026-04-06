import type { ProviderKey } from '@prisma/client';

export type GenerationJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

export type GenerationJobKind = 'image' | 'music' | 'video' | 'provider_async';

export type GenerationJobInput = {
  userId: string;
  providerKey: ProviderKey;
  kind: GenerationJobKind;
  prompt: string;
  chatId?: string;
  messageId?: string;
  metadata?: Record<string, unknown>;
};

export type QueuedGenerationJob = {
  status: GenerationJobStatus;
  input: GenerationJobInput;
  queuedAt: string;
};
