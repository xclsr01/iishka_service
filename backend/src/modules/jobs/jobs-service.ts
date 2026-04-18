import {
  GenerationJobKind,
  GenerationJobStatus,
  ProviderStatus,
  type GenerationJob,
  type Prisma,
  type Provider,
} from '@prisma/client';
import { assertPresent } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import { withOperationTimeout } from '../../lib/timeout';
import { getRegisteredProvider } from '../providers/provider-registry';
import { decideOrchestration } from '../orchestration/orchestration-service';
import { requireSubscriptionTokenBalance, TOKEN_COSTS } from '../subscriptions/subscription-service';
import { generationJobQueue } from './jobs-queue';
import type {
  EnqueueGenerationJobOptions,
  CreateGenerationJobInput,
  EnqueueGenerationJobInput,
  GenerationJobRecord,
  ListGenerationJobsInput,
  PresentedGenerationJob,
} from './jobs-types';

function presentGenerationJob(job: GenerationJobRecord): PresentedGenerationJob {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    prompt: job.prompt,
    failureCode: job.failureCode ?? null,
    failureMessage: job.failureMessage ?? null,
    externalJobId: job.externalJobId ?? null,
    providerRequestId: job.providerRequestId ?? null,
    attemptCount: job.attemptCount,
    queuedAt: job.queuedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    chatId: job.chatId ?? null,
    provider: {
      id: job.provider.id,
      key: job.provider.key,
      name: job.provider.name,
      slug: job.provider.slug,
      defaultModel: job.provider.defaultModel,
    },
    resultPayload: job.resultPayload ?? null,
  };
}

async function resolveJobProvider(providerId: string) {
  const provider = await withOperationTimeout(
    'jobs.resolveProvider',
    prisma.provider.findFirst({
      where: {
        id: providerId,
        status: ProviderStatus.ACTIVE,
      },
    }),
  );

  return assertPresent(provider, 'Provider not found');
}

async function assertJobChatOwnership(userId: string, chatId: string) {
  const chat = await withOperationTimeout(
    'jobs.assertChatOwnership',
    prisma.chat.findFirst({
      where: {
        id: chatId,
        userId,
      },
    }),
  );

  assertPresent(chat, 'Chat not found');
}

export function getGenerationJobTokenCost(kind: GenerationJobKind) {
  switch (kind) {
    case GenerationJobKind.IMAGE:
      return TOKEN_COSTS.image;
    case GenerationJobKind.MUSIC:
      return TOKEN_COSTS.music;
    case GenerationJobKind.VIDEO:
      return TOKEN_COSTS.video;
    case GenerationJobKind.PROVIDER_ASYNC:
      return TOKEN_COSTS.text;
    default:
      return TOKEN_COSTS.text;
  }
}

function buildQueueInput(job: GenerationJob, provider: Provider): EnqueueGenerationJobInput {
  return {
    jobId: job.id,
    providerKey: provider.key,
    kind: job.kind,
    prompt: job.prompt,
    chatId: job.chatId ?? undefined,
    metadata:
      job.metadata && typeof job.metadata === 'object' && !Array.isArray(job.metadata)
        ? (job.metadata as Record<string, unknown>)
        : undefined,
  };
}

export async function createGenerationJob(
  input: CreateGenerationJobInput,
  enqueueOptions?: EnqueueGenerationJobOptions,
) {
  const provider = await resolveJobProvider(input.providerId);
  const registeredProvider = getRegisteredProvider(provider.key);

  decideOrchestration(
    {
      providerKey: provider.key,
      preferredMode: 'async_job',
    },
    registeredProvider.metadata.capabilities,
  );

  if (input.chatId) {
    await assertJobChatOwnership(input.userId, input.chatId);
  }

  await requireSubscriptionTokenBalance(input.userId, getGenerationJobTokenCost(input.kind));

  const job = await withOperationTimeout(
    'jobs.create',
    prisma.generationJob.create({
      data: {
        userId: input.userId,
        providerId: provider.id,
        chatId: input.chatId,
        kind: input.kind,
        prompt: input.prompt,
        inputPayload: {
          prompt: input.prompt,
        } as Prisma.InputJsonValue,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
      include: {
        provider: true,
      },
    }),
  );

  await generationJobQueue.enqueue(buildQueueInput(job, provider), enqueueOptions);

  return presentGenerationJob(job);
}

export async function listGenerationJobs(input: ListGenerationJobsInput) {
  const jobs = await withOperationTimeout('jobs.list', prisma.generationJob.findMany({
    where: {
      userId: input.userId,
      providerId: input.providerId,
      kind: input.kind,
      status: input.status,
    },
    include: {
      provider: true,
    },
    orderBy: [{ createdAt: 'desc' }],
    take: input.limit ?? 20,
  }));

  return jobs.map(presentGenerationJob);
}

export async function getGenerationJob(userId: string, jobId: string) {
  const job = await withOperationTimeout(
    'jobs.get',
    prisma.generationJob.findFirst({
      where: {
        id: jobId,
        userId,
      },
      include: {
        provider: true,
      },
    }),
  );

  return presentGenerationJob(assertPresent(job, 'Generation job not found'));
}

export async function markGenerationJobRunning(jobId: string) {
  const result = await withOperationTimeout(
    'jobs.markRunning',
    prisma.generationJob.updateMany({
      where: {
        id: jobId,
        status: GenerationJobStatus.QUEUED,
      },
      data: {
        status: GenerationJobStatus.RUNNING,
        startedAt: new Date(),
        completedAt: null,
        failureCode: null,
        failureMessage: null,
        attemptCount: {
          increment: 1,
        },
      },
    }),
  );

  if (result.count === 0) {
    return null;
  }

  return withOperationTimeout(
    'jobs.findRunning',
    prisma.generationJob.findUnique({
      where: { id: jobId },
      include: {
        provider: true,
      },
    }),
  );
}

export async function completeGenerationJob(input: {
  jobId: string;
  resultPayload: Prisma.InputJsonValue;
  providerRequestId?: string | null;
  externalJobId?: string | null;
}) {
  return withOperationTimeout(
    'jobs.complete',
    prisma.generationJob.update({
      where: { id: input.jobId },
      data: {
        status: GenerationJobStatus.COMPLETED,
        resultPayload: input.resultPayload,
        providerRequestId: input.providerRequestId ?? null,
        externalJobId: input.externalJobId ?? null,
        completedAt: new Date(),
        failureCode: null,
        failureMessage: null,
      },
    }),
  );
}

export async function failGenerationJob(input: {
  jobId: string;
  failureCode: string;
  failureMessage: string;
  providerRequestId?: string | null;
  externalJobId?: string | null;
}) {
  return withOperationTimeout(
    'jobs.fail',
    prisma.generationJob.update({
      where: { id: input.jobId },
      data: {
        status: GenerationJobStatus.FAILED,
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
        providerRequestId: input.providerRequestId ?? null,
        externalJobId: input.externalJobId ?? null,
        completedAt: new Date(),
      },
    }),
  );
}

export async function getGenerationJobForExecution(jobId: string) {
  const job = await withOperationTimeout(
    'jobs.getForExecution',
    prisma.generationJob.findUnique({
      where: { id: jobId },
      include: {
        provider: true,
      },
    }),
  );

  return assertPresent(job, 'Generation job not found');
}
