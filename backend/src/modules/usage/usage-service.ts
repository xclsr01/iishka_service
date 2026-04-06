import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { getLogContext } from '../../lib/request-context';
import type { ProviderUsageRecord } from './usage-types';

export function normalizeProviderUsage(record: ProviderUsageRecord) {
  return {
    ...record,
    requestId: record.requestId ?? null,
    upstreamRequestId: record.upstreamRequestId ?? null,
    inputTokens: record.inputTokens ?? null,
    outputTokens: record.outputTokens ?? null,
    totalTokens:
      record.totalTokens ??
      (record.inputTokens != null || record.outputTokens != null
        ? (record.inputTokens ?? 0) + (record.outputTokens ?? 0)
        : null),
    requestUnits: record.requestUnits ?? null,
    latencyMs: record.latencyMs ?? null,
    metadata: record.metadata ?? {},
  };
}

export async function persistProviderUsage(record: ProviderUsageRecord) {
  const normalized = normalizeProviderUsage({
    ...record,
    requestId: record.requestId ?? getLogContext().requestId ?? null,
  });

  return prisma.providerUsage.create({
    data: {
      userId: normalized.userId,
      providerId: normalized.providerId,
      chatId: normalized.chatId ?? null,
      messageId: normalized.messageId ?? null,
      generationJobId: normalized.generationJobId ?? null,
      operation: normalized.operation,
      model: normalized.model,
      requestId: normalized.requestId,
      upstreamRequestId: normalized.upstreamRequestId,
      inputTokens: normalized.inputTokens,
      outputTokens: normalized.outputTokens,
      totalTokens: normalized.totalTokens,
      requestUnits: normalized.requestUnits,
      latencyMs: normalized.latencyMs,
      metadata: normalized.metadata as Prisma.InputJsonValue,
    },
  });
}
