import {
  GenerationJobKind,
  GenerationJobStatus,
  MessageStatus,
  Prisma,
  ProviderStatus,
  type GenerationJob,
  type FileAsset,
  type Provider,
} from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../env';
import { AppError } from '../../lib/errors';
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
  ListGenerationJobsInput,
  PresentedGenerationJobImageLinks,
  PresentedGenerationJob,
} from './jobs-types';

const IMAGE_LINK_TTL_SECONDS = 5 * 60;

type GeneratedImagePayload = {
  index: number;
  mimeType: string;
  filename: string;
  dataBase64: string;
  sizeBytes: number;
};

type ImageJobResultPayload = {
  kind: 'IMAGE';
  text?: string | null;
  images: GeneratedImagePayload[];
};

type PresentableGenerationJob = Pick<
  GenerationJob,
  | 'id'
  | 'userId'
  | 'providerId'
  | 'chatId'
  | 'kind'
  | 'status'
  | 'prompt'
  | 'metadata'
  | 'failureCode'
  | 'failureMessage'
  | 'providerRequestId'
  | 'externalJobId'
  | 'attemptCount'
  | 'queuedAt'
  | 'startedAt'
  | 'completedAt'
  | 'createdAt'
  | 'updatedAt'
> & {
  resultPayload?: Prisma.JsonValue | null;
  provider: Pick<Provider, 'id' | 'key' | 'name' | 'slug' | 'defaultModel'>;
};

const generationJobListSelect = {
  id: true,
  userId: true,
  providerId: true,
  chatId: true,
  kind: true,
  status: true,
  prompt: true,
  metadata: true,
  failureCode: true,
  failureMessage: true,
  providerRequestId: true,
  externalJobId: true,
  attemptCount: true,
  queuedAt: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  provider: {
    select: {
      id: true,
      key: true,
      name: true,
      slug: true,
      defaultModel: true,
    },
  },
} satisfies Prisma.GenerationJobSelect;

function toMetadataObject(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function getLinkedMessageId(value: Prisma.JsonValue | null) {
  const metadata = toMetadataObject(value);
  return typeof metadata?.linkedMessageId === 'string' ? metadata.linkedMessageId : null;
}

function getSourceUserMessageId(value: Prisma.JsonValue | null) {
  const metadata = toMetadataObject(value);
  return typeof metadata?.sourceUserMessageId === 'string'
    ? metadata.sourceUserMessageId
    : null;
}

function presentGenerationJob(job: PresentableGenerationJob): PresentedGenerationJob {
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
    messageId: getLinkedMessageId(job.metadata),
    provider: {
      id: job.provider.id,
      key: job.provider.key,
      name: job.provider.name,
      slug: job.provider.slug,
      defaultModel: job.provider.defaultModel,
    },
    resultPayload: 'resultPayload' in job ? job.resultPayload ?? null : null,
  };
}

function base64UrlEncode(input: string) {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecode(input: string) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signImageTokenPayload(encodedPayload: string) {
  return createHmac('sha256', `${env.JWT_SECRET}:job-image`)
    .update(encodedPayload)
    .digest('base64url');
}

function timingSafeStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function signJobImageToken(input: {
  userId: string;
  jobId: string;
  imageIndex: number;
  expiresAtSeconds: number;
}) {
  const encodedPayload = base64UrlEncode(JSON.stringify({
    sub: input.userId,
    jobId: input.jobId,
    imageIndex: input.imageIndex,
    exp: input.expiresAtSeconds,
  }));
  const signature = signImageTokenPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function verifyJobImageToken(token: string, jobId: string, imageIndex: number) {
  const [encodedPayload, signature] = token.split('.');

  if (!encodedPayload || !signature) {
    throw new AppError('Invalid image link', 401, 'UNAUTHORIZED');
  }

  const expectedSignature = signImageTokenPayload(encodedPayload);
  if (!timingSafeStringEqual(signature, expectedSignature)) {
    throw new AppError('Invalid image link', 401, 'UNAUTHORIZED');
  }

  let payload: {
    sub?: unknown;
    jobId?: unknown;
    imageIndex?: unknown;
    exp?: unknown;
  };

  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as typeof payload;
  } catch {
    throw new AppError('Invalid image link', 401, 'UNAUTHORIZED');
  }

  if (
    typeof payload.sub !== 'string' ||
    payload.jobId !== jobId ||
    payload.imageIndex !== imageIndex ||
    typeof payload.exp !== 'number' ||
    payload.exp <= Math.floor(Date.now() / 1000)
  ) {
    throw new AppError('Image link expired or invalid', 401, 'UNAUTHORIZED');
  }

  return payload.sub;
}

function isGeneratedImagePayload(value: unknown): value is GeneratedImagePayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<GeneratedImagePayload>;
  return (
    typeof candidate.index === 'number' &&
    typeof candidate.mimeType === 'string' &&
    typeof candidate.filename === 'string' &&
    typeof candidate.dataBase64 === 'string' &&
    typeof candidate.sizeBytes === 'number'
  );
}

function isImageJobResultPayload(value: unknown): value is ImageJobResultPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { kind?: unknown; images?: unknown };
  return candidate.kind === 'IMAGE' && Array.isArray(candidate.images);
}

function getImageFromJob(job: GenerationJob, imageIndex: number) {
  if (job.kind !== GenerationJobKind.IMAGE || job.status !== GenerationJobStatus.COMPLETED) {
    throw new AppError('Image is not ready', 404, 'IMAGE_NOT_READY');
  }

  if (!isImageJobResultPayload(job.resultPayload)) {
    throw new AppError('Image result is unavailable', 404, 'IMAGE_NOT_FOUND');
  }

  const images = job.resultPayload.images.filter(isGeneratedImagePayload);
  const image =
    images.find((candidate) => candidate.index === imageIndex) ??
    (imageIndex === 0 && images.length === 1 ? images[0] : null);

  if (!image) {
    throw new AppError('Image not found', 404, 'IMAGE_NOT_FOUND');
  }

  return image;
}

function buildImageUrl(jobId: string, imageIndex: number, token: string, disposition: 'inline' | 'attachment') {
  const url = new URL(`/api/jobs/${jobId}/images/${imageIndex}`, env.API_BASE_URL);
  url.searchParams.set('token', token);
  url.searchParams.set('disposition', disposition);
  return url.toString();
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

async function assertJobMessageOwnership(userId: string, messageId: string, chatId?: string) {
  const message = await withOperationTimeout(
    'jobs.assertMessageOwnership',
    prisma.message.findFirst({
      where: {
        id: messageId,
        userId,
        ...(chatId ? { chatId } : {}),
      },
    }),
  );

  assertPresent(message, 'Message not found');
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
        metadata: {
          ...(input.metadata ?? {}),
          ...(input.messageId ? { linkedMessageId: input.messageId } : {}),
        } as Prisma.InputJsonValue,
        nextAttemptAt: new Date(),
        maxAttempts: env.JOB_MAX_ATTEMPTS,
      },
      include: {
        provider: true,
      },
    }),
  );

  await generationJobQueue.enqueue(buildQueueInput(job, provider), enqueueOptions);

  const resolvedJob = await withOperationTimeout(
    'jobs.findAfterEnqueue',
    prisma.generationJob.findUnique({
      where: { id: job.id },
      include: {
        provider: true,
      },
    }),
  );

  return presentGenerationJob(assertPresent(resolvedJob, 'Generation job not found'));
}

export async function createLinkedGenerationJob(
  input: CreateGenerationJobInput,
  enqueueOptions?: EnqueueGenerationJobOptions,
) {
  if (!input.messageId) {
    throw new AppError('messageId is required for linked generation jobs', 400, 'INVALID_JOB_LINK');
  }

  if (input.chatId) {
    await assertJobMessageOwnership(input.userId, input.messageId, input.chatId);
  } else {
    await assertJobMessageOwnership(input.userId, input.messageId);
  }

  return createGenerationJob(input, enqueueOptions);
}

export async function listGenerationJobs(input: ListGenerationJobsInput) {
  const limit = input.limit ?? 20;
  const jobs = await withOperationTimeout('jobs.list', prisma.generationJob.findMany({
    where: {
      userId: input.userId,
      providerId: input.providerId,
      kind: input.kind,
      status: input.status,
    },
    select: generationJobListSelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...(input.cursor
      ? {
          cursor: {
            id: input.cursor,
          },
          skip: 1,
        }
      : {}),
    take: limit + 1,
  }));

  const page = jobs.slice(0, limit);
  const nextCursor = jobs.length > limit ? page.at(-1)?.id ?? null : null;

  return {
    jobs: page.map(presentGenerationJob),
    nextCursor,
  };
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

export async function deleteGenerationJob(userId: string, jobId: string) {
  const job = await withOperationTimeout(
    'jobs.delete.get',
    prisma.generationJob.findFirst({
      where: {
        id: jobId,
        userId,
      },
    }),
  );

  assertPresent(job, 'Generation job not found');

  await withOperationTimeout(
    'jobs.delete',
    prisma.generationJob.delete({
      where: { id: jobId },
    }),
  );
}

export async function createGenerationJobImageLinks(
  userId: string,
  jobId: string,
  imageIndex: number,
): Promise<PresentedGenerationJobImageLinks> {
  const job = await withOperationTimeout(
    'jobs.imageLinks.get',
    prisma.generationJob.findFirst({
      where: {
        id: jobId,
        userId,
      },
    }),
  );

  const image = getImageFromJob(assertPresent(job, 'Generation job not found'), imageIndex);

  const expiresAtSeconds = Math.floor(Date.now() / 1000) + IMAGE_LINK_TTL_SECONDS;
  const token = signJobImageToken({
    userId,
    jobId,
    imageIndex,
    expiresAtSeconds,
  });
  const openUrl = buildImageUrl(jobId, imageIndex, token, 'inline');
  const downloadUrl = buildImageUrl(jobId, imageIndex, token, 'attachment');

  return {
    openUrl,
    downloadUrl,
    filename: image.filename,
    mimeType: image.mimeType,
    disposition: 'inline',
    open: {
      url: openUrl,
      filename: image.filename,
      mimeType: image.mimeType,
      disposition: 'inline',
    },
    download: {
      url: downloadUrl,
      filename: image.filename,
      mimeType: image.mimeType,
      disposition: 'attachment',
    },
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
  };
}

type AsyncMessageProviderMetaInput = {
  requestedProviderKey: Provider['key'];
  requestedModel: string;
  jobId: string;
  jobKind: GenerationJobKind;
  prompt: string;
  status: GenerationJobStatus;
  sourceUserMessageId?: string | null;
  upstreamRequestId?: string | null;
  externalJobId?: string | null;
  resultPayload?: Record<string, unknown> | null;
  failureCode?: string | null;
  failureMessage?: string | null;
};

function toInputJsonObject(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | null {
  if (!value) {
    return null;
  }

  return value as Prisma.InputJsonValue;
}

export function buildAsyncMessageProviderMeta(input: AsyncMessageProviderMetaInput): Prisma.InputJsonValue {
  return {
    requestedProviderKey: input.requestedProviderKey,
    requestedModel: input.requestedModel,
    executionMode: 'async_job',
    jobId: input.jobId,
    jobKind: input.jobKind,
    prompt: input.prompt,
    status: input.status,
    sourceUserMessageId: input.sourceUserMessageId ?? null,
    mediaKind: input.jobKind === GenerationJobKind.VIDEO ? 'video' : 'async',
    upstreamRequestId: input.upstreamRequestId ?? null,
    externalJobId: input.externalJobId ?? null,
    resultPayload: toInputJsonObject(input.resultPayload),
    failureCode: input.failureCode ?? null,
    failureMessage: input.failureMessage ?? null,
  } satisfies Record<string, unknown>;
}

export async function getGenerationJobImageByToken(
  token: string,
  jobId: string,
  imageIndex: number,
) {
  const userId = verifyJobImageToken(token, jobId, imageIndex);
  const job = await withOperationTimeout(
    'jobs.imageByToken.get',
    prisma.generationJob.findFirst({
      where: {
        id: jobId,
        userId,
      },
    }),
  );

  return getImageFromJob(assertPresent(job, 'Generation job not found'), imageIndex);
}

type ClaimedGenerationJob = GenerationJob & {
  provider: Provider;
};

async function claimGenerationJob(input: {
  jobId?: string;
  claimOwner: string;
  now?: Date;
}): Promise<ClaimedGenerationJob | null> {
  const now = input.now ?? new Date();

  return withOperationTimeout(
    input.jobId ? 'jobs.claimById' : 'jobs.claimNext',
    prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "GenerationJob"
        WHERE "status" = 'QUEUED'::"GenerationJobStatus"
          ${input.jobId ? Prisma.sql`AND "id" = ${input.jobId}` : Prisma.empty}
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
          AND "attemptCount" < "maxAttempts"
        ORDER BY "queuedAt" ASC, "id" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `);

      const id = rows[0]?.id;
      if (!id) {
        return null;
      }

      return tx.generationJob.update({
        where: { id },
        data: {
          status: GenerationJobStatus.RUNNING,
          claimOwner: input.claimOwner,
          heartbeatAt: now,
          startedAt: now,
          completedAt: null,
          failureCode: null,
          failureMessage: null,
          nextAttemptAt: null,
          attemptCount: {
            increment: 1,
          },
        },
        include: {
          provider: true,
        },
      });
    }),
  );
}

export async function claimGenerationJobById(
  jobId: string,
  claimOwner: string,
) {
  return claimGenerationJob({ jobId, claimOwner });
}

export async function claimNextGenerationJob(claimOwner: string) {
  return claimGenerationJob({ claimOwner });
}

export async function heartbeatGenerationJob(
  jobId: string,
  claimOwner: string,
) {
  const result = await withOperationTimeout(
    'jobs.heartbeat',
    prisma.generationJob.updateMany({
      where: {
        id: jobId,
        status: GenerationJobStatus.RUNNING,
        claimOwner,
      },
      data: {
        heartbeatAt: new Date(),
      },
    }),
  );

  return result.count === 1;
}

export async function completeGenerationJob(input: {
  jobId: string;
  claimOwner?: string | null;
  resultPayload: Prisma.InputJsonValue;
  providerRequestId?: string | null;
  externalJobId?: string | null;
  messageId?: string | null;
  attachedFiles?: FileAsset[];
  messageProviderMeta?: Prisma.InputJsonValue;
}) {
  return withOperationTimeout(
    'jobs.complete',
    (async () => {
      const terminalData = {
        status: GenerationJobStatus.COMPLETED,
        resultPayload: input.resultPayload,
        providerRequestId: input.providerRequestId ?? null,
        externalJobId: input.externalJobId ?? null,
        completedAt: new Date(),
        failureCode: null,
        failureMessage: null,
        claimOwner: null,
        heartbeatAt: null,
        nextAttemptAt: null,
      } satisfies Prisma.GenerationJobUpdateManyMutationInput;

      let completedJob: GenerationJob | null;
      if (input.claimOwner !== undefined && input.claimOwner !== null) {
        const result = await prisma.generationJob.updateMany({
          where: {
            id: input.jobId,
            status: GenerationJobStatus.RUNNING,
            claimOwner: input.claimOwner,
          },
          data: terminalData,
        });
        completedJob =
          result.count === 1
            ? await prisma.generationJob.findUnique({ where: { id: input.jobId } })
            : null;
      } else {
        completedJob = await prisma.generationJob.update({
          where: { id: input.jobId },
          data: terminalData,
        });
      }

      if (!completedJob) {
        return null;
      }

      const followUpWrites: Prisma.PrismaPromise<unknown>[] = [];

      if (input.messageId) {
        if ((input.attachedFiles?.length ?? 0) > 0) {
          followUpWrites.push(
            prisma.messageAttachment.createMany({
              data: input.attachedFiles!.map((file) => ({
                messageId: input.messageId!,
                fileId: file.id,
              })),
              skipDuplicates: true,
            }),
          );
        }

        followUpWrites.push(
          prisma.message.update({
            where: { id: input.messageId },
            data: {
              status: MessageStatus.COMPLETED,
              content: completedJob.kind === GenerationJobKind.VIDEO
                ? 'Video generation completed.'
                : 'Generation completed.',
              failureReason: null,
              providerMeta: input.messageProviderMeta,
            },
          }),
        );
      }

      if (completedJob.chatId) {
        followUpWrites.push(
          prisma.chat.update({
            where: { id: completedJob.chatId },
            data: {
              lastMessageAt: new Date(),
            },
          }),
        );
      }

      if (followUpWrites.length > 0) {
        await prisma.$transaction(followUpWrites);
      }

      return completedJob;
    })(),
  );
}

export async function failGenerationJob(input: {
  jobId: string;
  claimOwner?: string | null;
  requireRunningStaleBefore?: Date;
  failureCode: string;
  failureMessage: string;
  providerRequestId?: string | null;
  externalJobId?: string | null;
  messageId?: string | null;
  messageProviderMeta?: Prisma.InputJsonValue;
}) {
  return withOperationTimeout(
    'jobs.fail',
    (async () => {
      const terminalData = {
        status: GenerationJobStatus.FAILED,
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
        providerRequestId: input.providerRequestId ?? null,
        externalJobId: input.externalJobId ?? null,
        completedAt: new Date(),
        claimOwner: null,
        heartbeatAt: null,
        nextAttemptAt: null,
      } satisfies Prisma.GenerationJobUpdateManyMutationInput;

      let failedJob: GenerationJob | null;
      if (
        input.claimOwner !== undefined ||
        input.requireRunningStaleBefore !== undefined
      ) {
        const where: Prisma.GenerationJobWhereInput = {
          id: input.jobId,
          ...(input.claimOwner !== undefined
            ? { claimOwner: input.claimOwner }
            : {}),
          ...(input.requireRunningStaleBefore
            ? {
                status: GenerationJobStatus.RUNNING,
                OR: [
                  {
                    heartbeatAt: {
                      lt: input.requireRunningStaleBefore,
                    },
                  },
                  {
                    heartbeatAt: null,
                    startedAt: {
                      lt: input.requireRunningStaleBefore,
                    },
                  },
                ],
              }
            : { status: GenerationJobStatus.RUNNING }),
        };
        const result = await prisma.generationJob.updateMany({
          where,
          data: terminalData,
        });
        failedJob =
          result.count === 1
            ? await prisma.generationJob.findUnique({ where: { id: input.jobId } })
            : null;
      } else {
        failedJob = await prisma.generationJob.update({
          where: { id: input.jobId },
          data: terminalData,
        });
      }

      if (!failedJob) {
        return null;
      }

      const followUpWrites: Prisma.PrismaPromise<unknown>[] = [];

      if (input.messageId) {
        followUpWrites.push(
          prisma.message.update({
            where: { id: input.messageId },
            data: {
              status: MessageStatus.FAILED,
              content: failedJob.kind === GenerationJobKind.VIDEO
                ? 'Video generation failed.'
                : 'Generation failed.',
              failureReason: input.failureMessage,
              providerMeta: input.messageProviderMeta,
            },
          }),
        );
      }

      if (failedJob.chatId) {
        followUpWrites.push(
          prisma.chat.update({
            where: { id: failedJob.chatId },
            data: {
              lastMessageAt: new Date(),
            },
          }),
        );
      }

      if (followUpWrites.length > 0) {
        await prisma.$transaction(followUpWrites);
      }

      return failedJob;
    })(),
  );
}

function getRetryDelayMs(attemptCount: number) {
  return Math.min(30_000 * Math.max(attemptCount, 1), 5 * 60_000);
}

export async function repairStaleGenerationJobs(input?: {
  staleBefore?: Date;
  now?: Date;
  batchSize?: number;
}) {
  const now = input?.now ?? new Date();
  const staleBefore =
    input?.staleBefore ??
    new Date(now.getTime() - env.JOB_RUNNING_STALE_AFTER_SECONDS * 1000);
  const batchSize = input?.batchSize ?? env.JOB_WORKER_BATCH_SIZE;

  const staleJobs = await withOperationTimeout(
    'jobs.findStaleRunning',
    prisma.generationJob.findMany({
      where: {
        status: GenerationJobStatus.RUNNING,
        OR: [
          {
            heartbeatAt: {
              lt: staleBefore,
            },
          },
          {
            heartbeatAt: null,
            startedAt: {
              lt: staleBefore,
            },
          },
        ],
      },
      include: {
        provider: true,
      },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
    }),
  );

  let requeued = 0;
  let failed = 0;

  for (const job of staleJobs) {
    if (job.attemptCount >= job.maxAttempts) {
      const failureCode = 'JOB_STALE_MAX_ATTEMPTS';
      const failureMessage = 'Generation job timed out. Please retry.';
      const linkedMessageId = getLinkedMessageId(job.metadata);
      const sourceUserMessageId = getSourceUserMessageId(job.metadata);
      const failedJob = await failGenerationJob({
        jobId: job.id,
        claimOwner: job.claimOwner,
        requireRunningStaleBefore: staleBefore,
        failureCode,
        failureMessage,
        providerRequestId: job.providerRequestId,
        externalJobId: job.externalJobId,
        messageId: linkedMessageId,
        messageProviderMeta: linkedMessageId
          ? buildAsyncMessageProviderMeta({
              requestedProviderKey: job.provider.key,
              requestedModel: job.provider.defaultModel,
              jobId: job.id,
              jobKind: job.kind,
              prompt: job.prompt,
              status: GenerationJobStatus.FAILED,
              sourceUserMessageId,
              upstreamRequestId: job.providerRequestId,
              externalJobId: job.externalJobId,
              failureCode,
              failureMessage,
            })
          : undefined,
      });

      if (failedJob) {
        failed += 1;
      }
      continue;
    }

    const result = await withOperationTimeout(
      'jobs.requeueStale',
      prisma.generationJob.updateMany({
        where: {
          id: job.id,
          status: GenerationJobStatus.RUNNING,
          claimOwner: job.claimOwner,
          OR: [
            {
              heartbeatAt: {
                lt: staleBefore,
              },
            },
            {
              heartbeatAt: null,
              startedAt: {
                lt: staleBefore,
              },
            },
          ],
        },
        data: {
          status: GenerationJobStatus.QUEUED,
          claimOwner: null,
          heartbeatAt: null,
          startedAt: null,
          completedAt: null,
          failureCode: null,
          failureMessage: null,
          nextAttemptAt: new Date(now.getTime() + getRetryDelayMs(job.attemptCount)),
        },
      }),
    );

    requeued += result.count;
  }

  return {
    scanned: staleJobs.length,
    requeued,
    failed,
  };
}

export async function getGenerationJobForExecution(jobId: string) {
  return withOperationTimeout(
    'jobs.getForExecution',
    prisma.generationJob.findUnique({
      where: { id: jobId },
      include: {
        provider: true,
      },
    }),
  );
}
