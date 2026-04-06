import type { ProviderUsageOperation } from '@prisma/client';

export type ProviderUsageRecord = {
  userId: string;
  providerId: string;
  operation: ProviderUsageOperation;
  model: string;
  chatId?: string | null;
  messageId?: string | null;
  generationJobId?: string | null;
  requestId?: string | null;
  upstreamRequestId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  requestUnits?: number | null;
  latencyMs?: number | null;
  metadata?: Record<string, unknown>;
};
