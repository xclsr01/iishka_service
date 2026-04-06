import type { ProviderKey } from '@prisma/client';

export type ProviderUsageRecord = {
  providerKey: ProviderKey;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  requestUnits?: number | null;
  metadata?: Record<string, unknown>;
};
