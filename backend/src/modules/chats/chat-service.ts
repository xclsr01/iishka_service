import {
  GenerationJobKind,
  GenerationJobStatus,
  type Chat,
  FileStatus,
  type FileAsset,
  type MessageRole,
  type Message,
  type MessageAttachment,
  MessageStatus,
  type Prisma,
  type Provider,
  ProviderKey,
  ProviderStatus,
} from '@prisma/client';
import { AppError } from '../../lib/errors';
import { assertPresent } from '../../lib/http';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { executeInteractiveGeneration } from '../orchestration/orchestration-service';
import { createLinkedGenerationJob } from '../jobs/jobs-service';
import { buildAsyncMessageProviderMeta } from '../jobs/jobs-service';
import { deleteStoredFiles } from '../files/file-service';
import { getRegisteredProvider } from '../providers/provider-registry';
import { ProviderAdapterError } from '../providers/provider-types';
import { toClientSafeProviderMessage } from '../providers/provider-error-mapping';
import {
  TOKEN_COSTS,
  consumeSubscriptionTokens,
  presentSubscription,
  requireActiveSubscription,
  requireSubscriptionTokenBalance,
} from '../subscriptions/subscription-service';
import { persistProviderUsage } from '../usage/usage-service';

const QUERY_TIMEOUT_MS = 8000;
const ASYNC_VIDEO_PENDING_CONTENT = 'Video generation in progress.';
const ASYNC_VIDEO_FAILED_CONTENT = 'Video generation failed.';

function toSafeFailureMessage(error: unknown) {
  if (error instanceof ProviderAdapterError) {
    return toClientSafeProviderMessage(error);
  }

  if (error instanceof AppError && error.statusCode < 500) {
    return error.message;
  }

  return 'The request failed. Please try again.';
}

function scheduleBackgroundGenerationTask(task: () => Promise<unknown>) {
  setImmediate(() => {
    void task();
  });
}

async function withTimeout<T>(label: string, operation: Promise<T>, timeoutMs = QUERY_TIMEOUT_MS) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new AppError(`Operation timed out: ${label}`, 504, 'OPERATION_TIMEOUT', { label }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function buildTitle(content: string) {
  return content.trim().slice(0, 48) || 'New chat';
}

type AsyncChatMessageMeta = {
  requestedProviderKey?: Provider['key'];
  requestedModel?: string;
  executionMode?: string;
  mediaKind?: string;
  prompt?: string;
  status?: string;
  jobId?: string;
  jobKind?: string;
  sourceUserMessageId?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
};

type AsyncChatMessageContext = {
  chat: Chat & {
    provider: Provider;
  };
  message: Message;
  meta: AsyncChatMessageMeta;
  jobKind: GenerationJobKind;
  prompt: string;
  sourceUserMessageId: string | null;
};

function buildAsyncGenerationJobMetadata(
  providerKey: Provider['key'],
  sourceUserMessageId: string | null,
) {
  return {
    ...(sourceUserMessageId ? { sourceUserMessageId } : {}),
    ...(providerKey === ProviderKey.VEO ? { durationSeconds: 4 } : {}),
  };
}

function getChatAsyncJobKind(providerKey: Provider['key']) {
  switch (providerKey) {
    case ProviderKey.VEO:
      return GenerationJobKind.VIDEO;
    default:
      return null;
  }
}

function isAsyncChatMessageMeta(value: Prisma.JsonValue | null): value is AsyncChatMessageMeta {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function buildQueuedAsyncMessageProviderMeta(input: {
  requestedProviderKey: Provider['key'];
  requestedModel: string;
  prompt: string;
  jobKind: GenerationJobKind;
  sourceUserMessageId?: string | null;
}) {
  return {
    requestedProviderKey: input.requestedProviderKey,
    requestedModel: input.requestedModel,
    executionMode: 'async_job',
    mediaKind: input.jobKind === GenerationJobKind.VIDEO ? 'video' : 'async',
    prompt: input.prompt,
    status: 'QUEUED',
    jobKind: input.jobKind,
    sourceUserMessageId: input.sourceUserMessageId ?? null,
  } as Prisma.InputJsonValue;
}

function attachmentsContext(files: FileAsset[]) {
  if (files.length === 0) {
    return null;
  }

  return [
    'Attached files metadata:',
    ...files.map(
      (file) =>
        `- ${file.originalName} (${file.mimeType}, ${Math.round(file.sizeBytes / 1024)} KB, sha256 ${file.checksumSha256})`,
    ),
    'Use the file metadata as context. Binary parsing can be upgraded later.',
  ].join('\n');
}

function mapHistory(
  messages: Array<{
    role: MessageRole;
    content: string;
  }>,
  fileNote: string | null,
) {
  const providerMessages = messages.map((message) => ({
    role: message.role.toLowerCase() as 'system' | 'user' | 'assistant',
    content: message.content,
  }));

  if (fileNote) {
    providerMessages.push({
      role: 'system',
      content: fileNote,
    });
  }

  return providerMessages;
}

async function mapProvidersById(providerIds: string[]) {
  if (providerIds.length === 0) {
    return new Map<string, Provider>();
  }

  const providers = await withTimeout(
    'mapProvidersById.findMany',
    prisma.provider.findMany({
      where: {
        id: { in: providerIds },
      },
    }),
  );

  return new Map(providers.map((provider) => [provider.id, provider]));
}

async function mapAttachmentsByMessageId(messageIds: string[]) {
  if (messageIds.length === 0) {
    return new Map<string, Array<{ file: FileAsset }>>();
  }

  const attachments = await withTimeout(
    'mapAttachmentsByMessageId.findManyAttachments',
    prisma.messageAttachment.findMany({
      where: {
        messageId: { in: messageIds },
      },
    }),
  );

  const fileIds = Array.from(new Set(attachments.map((attachment) => attachment.fileId)));
  const files = fileIds.length
    ? await withTimeout(
        'mapAttachmentsByMessageId.findManyFiles',
        prisma.fileAsset.findMany({
          where: {
            id: { in: fileIds },
          },
        }),
      )
    : [];

  const filesById = new Map(files.map((file) => [file.id, file]));
  const attachmentsByMessageId = new Map<string, Array<{ file: FileAsset }>>();

  for (const attachment of attachments) {
    const file = filesById.get(attachment.fileId);
    if (!file) {
      continue;
    }

    const existing = attachmentsByMessageId.get(attachment.messageId) ?? [];
    existing.push({ file });
    attachmentsByMessageId.set(attachment.messageId, existing);
  }

  return attachmentsByMessageId;
}

async function assembleChat(chat: Chat, messages: Message[]) {
  const provider = assertPresent(
    await withTimeout(
      'assembleChat.findUniqueProvider',
      prisma.provider.findUnique({
        where: { id: chat.providerId },
      }),
    ),
    'Provider not found',
  );

  const attachmentsByMessageId = await mapAttachmentsByMessageId(messages.map((message) => message.id));

  return {
    ...chat,
    provider,
    messages: messages.map((message) => ({
      ...message,
      attachments: attachmentsByMessageId.get(message.id) ?? [],
    })),
  };
}

async function resolveUsageProvider(chatProvider: Provider, executedProviderKey: Provider['key']) {
  if (chatProvider.key === executedProviderKey) {
    return chatProvider;
  }

  return assertPresent(
    await withTimeout(
      'resolveUsageProvider.findFirst',
      prisma.provider.findFirst({
        where: {
          key: executedProviderKey,
          status: ProviderStatus.ACTIVE,
        },
      }),
    ),
    'Provider not found',
  );
}

async function refreshChatLastMessageAtTx(tx: Prisma.TransactionClient, chatId: string) {
  const latestMessage = await tx.message.findFirst({
    where: {
      chatId,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  await tx.chat.update({
    where: { id: chatId },
    data: {
      lastMessageAt: latestMessage?.createdAt ?? null,
    },
  });
}

async function detachMessageFilesTx(tx: Prisma.TransactionClient, messageId: string, userId: string) {
  const attachments = await tx.messageAttachment.findMany({
    where: {
      messageId,
    },
    include: {
      file: true,
    },
  });

  if (attachments.length === 0) {
    return [];
  }

  const removableFiles: Array<{ id: string; storageKey: string }> = [];

  for (const attachment of attachments) {
    if (attachment.file.userId !== userId) {
      continue;
    }

    const attachmentCount = await tx.messageAttachment.count({
      where: {
        fileId: attachment.fileId,
      },
    });

    if (attachmentCount <= 1) {
      removableFiles.push({
        id: attachment.fileId,
        storageKey: attachment.file.storageKey,
      });
    }
  }

  await tx.messageAttachment.deleteMany({
    where: {
      messageId,
    },
  });

  if (removableFiles.length > 0) {
    await tx.fileAsset.deleteMany({
      where: {
        id: {
          in: removableFiles.map((file) => file.id),
        },
        userId,
      },
    });
  }

  return removableFiles;
}

async function getAsyncChatMessageContext(
  userId: string,
  chatId: string,
  messageId: string,
): Promise<AsyncChatMessageContext> {
  const chat = assertPresent(
    await withTimeout(
      'getAsyncChatMessageContext.findChat',
      prisma.chat.findFirst({
        where: {
          id: chatId,
          userId,
        },
        include: {
          provider: true,
        },
      }),
    ),
    'Chat not found',
  );

  const message = assertPresent(
    await withTimeout(
      'getAsyncChatMessageContext.findMessage',
      prisma.message.findFirst({
        where: {
          id: messageId,
          chatId: chat.id,
          userId,
        },
      }),
    ),
    'Message not found',
  );

  if (message.role !== 'ASSISTANT') {
    throw new AppError('Only assistant async messages can be managed here', 400, 'INVALID_MESSAGE');
  }

  if (!isAsyncChatMessageMeta(message.providerMeta) || message.providerMeta.executionMode !== 'async_job') {
    throw new AppError('Message does not support async actions', 400, 'INVALID_MESSAGE');
  }

  const jobKind = getChatAsyncJobKind(chat.provider.key);
  if (!jobKind) {
    throw new AppError('Provider does not support async chat actions', 400, 'INVALID_PROVIDER');
  }

  const prompt = typeof message.providerMeta.prompt === 'string' ? message.providerMeta.prompt.trim() : '';
  if (!prompt) {
    throw new AppError('Async message prompt is unavailable', 400, 'INVALID_MESSAGE');
  }

  return {
    chat,
    message,
    meta: message.providerMeta,
    jobKind,
    prompt,
    sourceUserMessageId:
      typeof message.providerMeta.sourceUserMessageId === 'string'
        ? message.providerMeta.sourceUserMessageId
        : null,
  };
}

export async function listChats(userId: string) {
  const chats = await withTimeout(
    'listChats.findManyChats',
    prisma.chat.findMany({
      where: { userId },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
    }),
  );

  const providersById = await mapProvidersById(Array.from(new Set(chats.map((chat) => chat.providerId))));
  const chatIds = chats.map((chat) => chat.id);
  const latestMessages = chatIds.length
    ? await withTimeout(
        'listChats.findManyLatestMessages',
        prisma.message.findMany({
          where: {
            chatId: { in: chatIds },
          },
          orderBy: [{ chatId: 'asc' }, { createdAt: 'desc' }],
        }),
      )
    : [];

  const latestByChatId = new Map<string, Message>();
  for (const message of latestMessages) {
    if (!latestByChatId.has(message.chatId)) {
      latestByChatId.set(message.chatId, message);
    }
  }

  return chats.map((chat) => ({
    ...chat,
    provider: assertPresent(providersById.get(chat.providerId), 'Provider not found'),
    messages: latestByChatId.has(chat.id) ? [latestByChatId.get(chat.id)!] : [],
  }));
}

export async function createChat(userId: string, providerId: string, title?: string) {
  const provider = assertPresent(
    await withTimeout(
      'createChat.findProvider',
      prisma.provider.findFirst({
        where: {
          id: providerId,
          status: ProviderStatus.ACTIVE,
        },
      }),
    ),
    'Provider not found',
  );

  return withTimeout(
    'createChat.create',
    prisma.chat.create({
      data: {
        userId,
        providerId: provider.id,
        title: title?.trim() || `${provider.name} chat`,
      },
      include: {
        provider: true,
      },
    }),
  );
}

export async function getChatWithMessages(userId: string, chatId: string) {
  const chat = await withTimeout(
    'getChatWithMessages.findChat',
    prisma.chat.findFirst({
      where: {
        id: chatId,
        userId,
      },
    }),
  );
  const resolvedChat = assertPresent(chat, 'Chat not found');
  const messages = await withTimeout(
    'getChatWithMessages.findMessages',
    prisma.message.findMany({
      where: {
        chatId: resolvedChat.id,
      },
      orderBy: { createdAt: 'asc' },
    }),
  );

  return withTimeout('getChatWithMessages.assembleChat', assembleChat(resolvedChat, messages));
}

export async function createMessage(input: {
  userId: string;
  chatId: string;
  content: string;
  fileIds?: string[];
}) {
  logger.info('create_message_started', {
    userId: input.userId,
    chatId: input.chatId,
    fileCount: input.fileIds?.length ?? 0,
  });

  const content = input.content.trim();
  if (!content) {
    throw new AppError('Message cannot be empty', 400, 'INVALID_MESSAGE');
  }

  await withTimeout(
    'createMessage.requireActiveSubscription',
    requireActiveSubscription(input.userId),
  );
  logger.info('create_message_subscription_ok', {
    userId: input.userId,
    chatId: input.chatId,
  });

  const chat = assertPresent(
    await withTimeout(
      'createMessage.findChat',
      prisma.chat.findFirst({
        where: {
          id: input.chatId,
          userId: input.userId,
        },
        include: {
          provider: true,
        },
      }),
    ),
    'Chat not found',
  );
  logger.info('create_message_chat_loaded', {
    userId: input.userId,
    chatId: chat.id,
    providerKey: chat.provider.key,
  });

  const chatAsyncJobKind = getChatAsyncJobKind(chat.provider.key);
  const registeredProvider = getRegisteredProvider(chat.provider.key);

  const subscription = chatAsyncJobKind && registeredProvider.metadata.executionMode === 'async-job'
    ? await withTimeout(
        'createMessage.requireAsyncJobTokenBalance',
        requireSubscriptionTokenBalance(
          input.userId,
          chatAsyncJobKind === GenerationJobKind.VIDEO ? TOKEN_COSTS.video : TOKEN_COSTS.text,
        ),
      )
    : null;

  const files = input.fileIds?.length
    ? await withTimeout(
        'createMessage.findFiles',
        prisma.fileAsset.findMany({
          where: {
            id: { in: input.fileIds },
            userId: input.userId,
            status: FileStatus.READY,
          },
        }),
      )
    : [];

  if ((input.fileIds?.length ?? 0) !== files.length) {
    throw new AppError('Some files are missing or unavailable', 400, 'INVALID_FILE_REFERENCE');
  }
  logger.info('create_message_files_loaded', {
    chatId: chat.id,
    fileCount: files.length,
  });

  const userMessage = await withTimeout(
    'createMessage.createUserMessage',
    prisma.message.create({
      data: {
        chatId: chat.id,
        userId: input.userId,
        role: 'USER',
        content,
      },
    }),
  );

  if (files.length > 0) {
    await withTimeout(
      'createMessage.createAttachments',
      prisma.messageAttachment.createMany({
        data: files.map((file) => ({
          messageId: userMessage.id,
          fileId: file.id,
        })),
      }),
    );
  }
  logger.info('create_message_user_message_saved', {
    chatId: chat.id,
    messageId: userMessage.id,
  });

  const attachmentsByMessageId = await mapAttachmentsByMessageId([userMessage.id]);
  const userMessageWithAttachments = {
    ...userMessage,
    attachments: attachmentsByMessageId.get(userMessage.id) ?? [],
  };

  if (chatAsyncJobKind && registeredProvider.metadata.executionMode === 'async-job') {
    const assistantMessage = await withTimeout(
      'createMessage.createAsyncAssistantMessage',
      prisma.message.create({
        data: {
          chatId: chat.id,
          userId: input.userId,
          role: 'ASSISTANT',
          content: ASYNC_VIDEO_PENDING_CONTENT,
          status: MessageStatus.STREAMING,
          providerMeta: buildQueuedAsyncMessageProviderMeta({
            requestedProviderKey: chat.provider.key,
            requestedModel: chat.provider.defaultModel,
            prompt: content,
            jobKind: chatAsyncJobKind,
            sourceUserMessageId: userMessage.id,
          }),
        },
      }),
    );

    try {
      const job = await withTimeout(
        'createMessage.createAsyncGenerationJob',
        createLinkedGenerationJob(
          {
            userId: input.userId,
            providerId: chat.provider.id,
            kind: chatAsyncJobKind,
            prompt: content,
            chatId: chat.id,
            messageId: assistantMessage.id,
            metadata: buildAsyncGenerationJobMetadata(chat.provider.key, userMessage.id),
          },
          {
            schedule: scheduleBackgroundGenerationTask,
          },
        ),
        5000,
      );

      const assistantProviderMeta = buildAsyncMessageProviderMeta({
        requestedProviderKey: chat.provider.key,
        requestedModel: chat.provider.defaultModel,
        jobId: job.id,
        jobKind: chatAsyncJobKind,
        prompt: content,
        status: job.status,
        sourceUserMessageId: userMessage.id,
        upstreamRequestId: job.providerRequestId,
        externalJobId: job.externalJobId,
        resultPayload:
          job.resultPayload && typeof job.resultPayload === 'object' && !Array.isArray(job.resultPayload)
            ? (job.resultPayload as Record<string, unknown>)
            : null,
        failureCode: job.failureCode,
        failureMessage: job.failureMessage,
      });

      const updatedAssistantMessage = await withTimeout(
        'createMessage.updateAsyncAssistantMessage',
        prisma.message.update({
          where: { id: assistantMessage.id },
          data: {
            providerMeta: assistantProviderMeta,
          },
        }),
      );

      await withTimeout(
        'createMessage.updateChatAsync',
        prisma.chat.update({
          where: { id: chat.id },
          data: {
            title: buildTitle(content),
            lastMessageAt: updatedAssistantMessage.createdAt,
          },
        }),
      );

      logger.info('create_message_async_job_created', {
        chatId: chat.id,
        userMessageId: userMessage.id,
        assistantMessageId: updatedAssistantMessage.id,
        generationJobId: job.id,
        providerKey: chat.provider.key,
      });

      return {
        userMessage: userMessageWithAttachments,
        assistantMessage: {
          ...updatedAssistantMessage,
          attachments: [],
        },
        subscription: presentSubscription(assertPresent(subscription, 'Subscription not found')),
      };
    } catch (error) {
      await withTimeout(
        'createMessage.failAsyncAssistantMessage',
        prisma.message.update({
          where: { id: assistantMessage.id },
          data: {
            status: MessageStatus.FAILED,
            content: ASYNC_VIDEO_FAILED_CONTENT,
            failureReason: toSafeFailureMessage(error),
            providerMeta: buildAsyncMessageProviderMeta({
              requestedProviderKey: chat.provider.key,
              requestedModel: chat.provider.defaultModel,
              jobId: `create-failed-${assistantMessage.id}`,
              jobKind: chatAsyncJobKind,
              prompt: content,
              status: GenerationJobStatus.FAILED,
              sourceUserMessageId: userMessage.id,
              failureCode: error instanceof Error && 'code' in error ? String(error.code) : 'JOB_CREATE_FAILED',
              failureMessage: toSafeFailureMessage(error),
            }),
          },
        }),
      ).catch(() => undefined);

      throw error;
    }
  }

  const history = await withTimeout(
    'createMessage.findHistory',
    prisma.message.findMany({
      where: {
        chatId: chat.id,
      },
      orderBy: { createdAt: 'asc' },
    }),
  );

  const fileNote = attachmentsContext(files);
  let assistantMessage;
  let updatedSubscription;
  try {
    logger.info('create_message_provider_request_started', {
      chatId: chat.id,
      providerKey: chat.provider.key,
      model: chat.provider.defaultModel,
    });
    const result = await withTimeout(
      'createMessage.providerGenerateResponse',
      executeInteractiveGeneration({
        providerKey: chat.provider.key,
        model: chat.provider.defaultModel,
        messages: mapHistory(history, fileNote),
        requiresFileContext: files.length > 0,
        chatId: chat.id,
        userId: input.userId,
      }),
      20000,
    );

    assistantMessage = await withTimeout(
      'createMessage.createAssistantMessage',
      prisma.message.create({
        data: {
          chatId: chat.id,
          userId: input.userId,
          role: 'ASSISTANT',
          content: result.text,
          status: MessageStatus.COMPLETED,
          providerMeta: {
            ...result.raw,
            requestedProviderKey: chat.provider.key,
            executedProviderKey: result.providerKey,
            requestedModel: chat.provider.defaultModel,
            executedModel: result.model,
            fallbackUsed: result.fallbackUsed,
            attempts: result.attempts,
            executionMode: result.decision.mode,
            capabilities: result.capabilities,
            usage: result.usage,
            upstreamRequestId: result.upstreamRequestId,
          } as Prisma.InputJsonValue,
        },
      }),
    );
    updatedSubscription = await withTimeout(
      'createMessage.consumeSubscriptionTokens',
      consumeSubscriptionTokens(input.userId, TOKEN_COSTS.text),
    );
    await withTimeout(
      'createMessage.persistProviderUsage',
      (async () => {
        const usageProvider = await resolveUsageProvider(chat.provider, result.providerKey);
        return persistProviderUsage({
          userId: input.userId,
          providerId: usageProvider.id,
          chatId: chat.id,
          messageId: assistantMessage.id,
          operation: 'CHAT_GENERATION',
          model: result.model,
          upstreamRequestId: result.upstreamRequestId,
          inputTokens: result.usage?.inputTokens ?? null,
          outputTokens: result.usage?.outputTokens ?? null,
          totalTokens: result.usage?.totalTokens ?? null,
          requestUnits: result.usage?.requestUnits ?? null,
          latencyMs: result.latencyMs,
          metadata: {
            requestedProviderKey: chat.provider.key,
            executedProviderKey: result.providerKey,
            fallbackUsed: result.fallbackUsed,
            attempts: result.attempts,
            executionMode: result.decision.mode,
            capabilities: result.capabilities,
            rawUsage: result.usage?.raw ?? null,
          },
        });
      })().catch((usageError) => {
        logger.error('provider_usage_record_failed', {
          chatId: chat.id,
          providerKey: result.providerKey,
          requestedProviderKey: chat.provider.key,
          message: usageError instanceof Error ? usageError.message : 'unknown',
        });
      }),
    );
    logger.info('create_message_provider_request_completed', {
      chatId: chat.id,
      assistantMessageId: assistantMessage.id,
      providerKey: result.providerKey,
      fallbackUsed: result.fallbackUsed,
    });
  } catch (error) {
    logger.error('create_message_provider_request_failed', {
      chatId: chat.id,
      providerKey: chat.provider.key,
      code: error instanceof ProviderAdapterError ? error.code : null,
      category: error instanceof ProviderAdapterError ? error.category : null,
      retryable: error instanceof ProviderAdapterError ? error.retryable : null,
      upstreamStatus: error instanceof ProviderAdapterError ? error.upstreamStatus ?? null : null,
      upstreamRequestId:
        error instanceof ProviderAdapterError ? error.upstreamRequestId ?? null : null,
      details: error instanceof ProviderAdapterError ? error.details ?? null : null,
      message: error instanceof Error ? error.message : 'unknown',
      stack: error instanceof Error ? error.stack ?? null : null,
    });
    await withTimeout(
      'createMessage.createFailureMessage',
      prisma.message.create({
        data: {
          chatId: chat.id,
          userId: input.userId,
          role: 'ASSISTANT',
          content: 'The provider request failed. Please retry.',
          status: MessageStatus.FAILED,
          failureReason: toSafeFailureMessage(error),
        },
      }),
    );
    throw error;
  }

  await withTimeout(
    'createMessage.updateChat',
    prisma.chat.update({
      where: { id: chat.id },
      data: {
        title: history.length === 1 ? buildTitle(content) : chat.title,
        lastMessageAt: assistantMessage.createdAt,
      },
    }),
  );
  logger.info('create_message_completed', {
    chatId: chat.id,
    userMessageId: userMessage.id,
    assistantMessageId: assistantMessage.id,
  });

  return {
    userMessage: userMessageWithAttachments,
    assistantMessage: {
      ...assistantMessage,
      attachments: [],
    },
    subscription: presentSubscription(updatedSubscription),
  };
}

export async function retryAsyncMessage(input: {
  userId: string;
  chatId: string;
  messageId: string;
}) {
  await withTimeout(
    'retryAsyncMessage.requireActiveSubscription',
    requireActiveSubscription(input.userId),
  );

  const context = await getAsyncChatMessageContext(input.userId, input.chatId, input.messageId);
  if (!(context.message.status === MessageStatus.FAILED || context.meta.status === GenerationJobStatus.CANCELED)) {
    throw new AppError('Only failed async messages can be retried', 400, 'INVALID_MESSAGE_STATE');
  }

  await withTimeout(
    'retryAsyncMessage.requireTokenBalance',
    requireSubscriptionTokenBalance(input.userId, getChatAsyncJobKind(context.chat.provider.key) === GenerationJobKind.VIDEO ? TOKEN_COSTS.video : TOKEN_COSTS.text),
  );

  const removableFiles = await withTimeout(
    'retryAsyncMessage.resetMessage',
    prisma.$transaction(async (tx) => {
      const detachedFiles = await detachMessageFilesTx(tx, context.message.id, input.userId);
      await tx.message.update({
        where: { id: context.message.id },
        data: {
          status: MessageStatus.STREAMING,
          content: ASYNC_VIDEO_PENDING_CONTENT,
          failureReason: null,
          providerMeta: buildQueuedAsyncMessageProviderMeta({
            requestedProviderKey: context.chat.provider.key,
            requestedModel: context.chat.provider.defaultModel,
            prompt: context.prompt,
            jobKind: context.jobKind,
            sourceUserMessageId: context.sourceUserMessageId,
          }),
        },
      });

      await tx.chat.update({
        where: { id: context.chat.id },
        data: {
          lastMessageAt: new Date(),
        },
      });

      return detachedFiles;
    }),
  );

  if (removableFiles.length > 0) {
    await deleteStoredFiles(removableFiles.map((file) => file.storageKey)).catch((error) => {
      logger.error('async_message_retry_storage_cleanup_failed', {
        chatId: context.chat.id,
        messageId: context.message.id,
        fileCount: removableFiles.length,
        message: error instanceof Error ? error.message : 'unknown',
      });
    });
  }

  try {
    const job = await withTimeout(
      'retryAsyncMessage.createGenerationJob',
      createLinkedGenerationJob(
        {
          userId: input.userId,
          providerId: context.chat.provider.id,
          kind: context.jobKind,
          prompt: context.prompt,
          chatId: context.chat.id,
          messageId: context.message.id,
          metadata: buildAsyncGenerationJobMetadata(
            context.chat.provider.key,
            context.sourceUserMessageId,
          ),
        },
        {
          schedule: scheduleBackgroundGenerationTask,
        },
      ),
      5000,
    );

    const updatedMessage = await withTimeout(
      'retryAsyncMessage.updateMessageMeta',
      prisma.message.update({
        where: { id: context.message.id },
        data: {
          providerMeta: buildAsyncMessageProviderMeta({
            requestedProviderKey: context.chat.provider.key,
            requestedModel: context.chat.provider.defaultModel,
            jobId: job.id,
            jobKind: context.jobKind,
            prompt: context.prompt,
            status: job.status,
            sourceUserMessageId: context.sourceUserMessageId,
            upstreamRequestId: job.providerRequestId,
            externalJobId: job.externalJobId,
            resultPayload:
              job.resultPayload && typeof job.resultPayload === 'object' && !Array.isArray(job.resultPayload)
                ? (job.resultPayload as Record<string, unknown>)
                : null,
            failureCode: job.failureCode,
            failureMessage: job.failureMessage,
          }),
        },
      }),
    );

    logger.info('async_message_retry_scheduled', {
      chatId: context.chat.id,
      messageId: context.message.id,
      generationJobId: job.id,
      providerKey: context.chat.provider.key,
    });

    return {
      message: {
        ...updatedMessage,
        attachments: [],
      },
    };
  } catch (error) {
    const failureCode = error instanceof Error && 'code' in error ? String(error.code) : 'JOB_EXECUTION_FAILED';
    const failureMessage = error instanceof Error ? error.message : 'Video generation failed';

    await withTimeout(
      'retryAsyncMessage.failMessage',
      prisma.message.update({
        where: { id: context.message.id },
        data: {
          status: MessageStatus.FAILED,
          content: ASYNC_VIDEO_FAILED_CONTENT,
          failureReason: failureMessage,
          providerMeta: buildAsyncMessageProviderMeta({
            requestedProviderKey: context.chat.provider.key,
            requestedModel: context.chat.provider.defaultModel,
            jobId: context.meta.jobId ?? `retry-failed-${context.message.id}`,
            jobKind: context.jobKind,
            prompt: context.prompt,
            status: GenerationJobStatus.FAILED,
            sourceUserMessageId: context.sourceUserMessageId,
            failureCode,
            failureMessage,
          }),
        },
      }),
    ).catch(() => undefined);

    throw error;
  }
}

export async function deleteAsyncMessage(input: {
  userId: string;
  chatId: string;
  messageId: string;
}) {
  const context = await getAsyncChatMessageContext(input.userId, input.chatId, input.messageId);

  const removableFiles = await withTimeout(
    'deleteAsyncMessage.transaction',
    prisma.$transaction(async (tx) => {
      const detachedFiles = await detachMessageFilesTx(tx, context.message.id, input.userId);

      await tx.generationJob.deleteMany({
        where: {
          userId: input.userId,
          metadata: {
            path: ['linkedMessageId'],
            equals: context.message.id,
          },
        },
      });

      await tx.message.delete({
        where: { id: context.message.id },
      });

      if (context.sourceUserMessageId) {
        const sourceMessage = await tx.message.findFirst({
          where: {
            id: context.sourceUserMessageId,
            userId: input.userId,
            chatId: context.chat.id,
            role: 'USER',
          },
        });

        if (sourceMessage) {
          const sourceAttachmentCount = await tx.messageAttachment.count({
            where: {
              messageId: sourceMessage.id,
            },
          });

          if (sourceAttachmentCount === 0) {
            await tx.message.delete({
              where: { id: sourceMessage.id },
            });
          }
        }
      }

      await refreshChatLastMessageAtTx(tx, context.chat.id);
      return detachedFiles;
    }),
  );

  if (removableFiles.length > 0) {
    await deleteStoredFiles(removableFiles.map((file) => file.storageKey)).catch((error) => {
      logger.error('async_message_delete_storage_cleanup_failed', {
        chatId: context.chat.id,
        messageId: context.message.id,
        fileCount: removableFiles.length,
        message: error instanceof Error ? error.message : 'unknown',
      });
    });
  }

  logger.info('async_message_deleted', {
    chatId: context.chat.id,
    messageId: context.message.id,
    providerKey: context.chat.provider.key,
  });
}
