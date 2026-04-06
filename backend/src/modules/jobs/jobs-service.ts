import {
  GenerationJobStatus,
  ProviderStatus,
  type GenerationJob,
  type Prisma,
  type Provider,
} from '@prisma/client';
import { AppError } from '../../lib/errors';
import { assertPresent } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import { getRegisteredProvider } from '../providers/provider-registry';
import { decideOrchestration } from '../orchestration/orchestration-service';
import { generationJobQueue } from './jobs-queue';
import type {
  CreateGenerationJobInput,
  EnqueueGenerationJobInput,
  GenerationJobRecord,
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
  const provider = await prisma.provider.findFirst({
    where: {
      id: providerId,
      status: ProviderStatus.ACTIVE,
    },
  });

  return assertPresent(provider, 'Provider not found');
}

async function assertJobChatOwnership(userId: string, chatId: string) {
  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      userId,
    },
  });

  assertPresent(chat, 'Chat not found');
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

export async function createGenerationJob(input: CreateGenerationJobInput) {
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

  const job = await prisma.generationJob.create({
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
  });

  await generationJobQueue.enqueue(buildQueueInput(job, provider));

  return presentGenerationJob(job);
}

export async function listGenerationJobs(userId: string) {
  const jobs = await prisma.generationJob.findMany({
    where: {
      userId,
    },
    include: {
      provider: true,
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  return jobs.map(presentGenerationJob);
}

export async function getGenerationJob(userId: string, jobId: string) {
  const job = await prisma.generationJob.findFirst({
    where: {
      id: jobId,
      userId,
    },
    include: {
      provider: true,
    },
  });

  return presentGenerationJob(assertPresent(job, 'Generation job not found'));
}

export async function markGenerationJobRunning(jobId: string) {
  return prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: GenerationJobStatus.RUNNING,
      startedAt: new Date(),
      attemptCount: {
        increment: 1,
      },
    },
  });
}

export async function completeGenerationJob(jobId: string, resultPayload: Prisma.InputJsonValue) {
  return prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: GenerationJobStatus.COMPLETED,
      resultPayload,
      completedAt: new Date(),
      failureCode: null,
      failureMessage: null,
    },
  });
}

export async function failGenerationJob(input: {
  jobId: string;
  failureCode: string;
  failureMessage: string;
}) {
  return prisma.generationJob.update({
    where: { id: input.jobId },
    data: {
      status: GenerationJobStatus.FAILED,
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
      completedAt: new Date(),
    },
  });
}
