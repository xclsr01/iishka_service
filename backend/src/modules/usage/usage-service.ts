import type { ProviderUsageRecord } from './usage-types';

export function normalizeProviderUsage(record: ProviderUsageRecord) {
  return {
    ...record,
    inputTokens: record.inputTokens ?? null,
    outputTokens: record.outputTokens ?? null,
    totalTokens:
      record.totalTokens ??
      (record.inputTokens != null || record.outputTokens != null
        ? (record.inputTokens ?? 0) + (record.outputTokens ?? 0)
        : null),
    requestUnits: record.requestUnits ?? null,
    metadata: record.metadata ?? {},
  };
}
