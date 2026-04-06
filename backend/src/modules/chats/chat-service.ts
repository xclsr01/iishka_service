import {
  type Chat,
  FileStatus,
  type FileAsset,
  type MessageRole,
  type Message,
  type MessageAttachment,
  MessageStatus,
  type Prisma,
  type Provider,
  ProviderStatus,
} from '@prisma/client';
import { AppError } from '../../lib/errors';
import { assertPresent } from '../../lib/http';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { executeInteractiveGeneration } from '../orchestration/orchestration-service';
import {
  TOKEN_COSTS,
  consumeSubscriptionTokens,
  presentSubscription,
  requireActiveSubscription,
} from '../subscriptions/subscription-service';
import { persistProviderUsage } from '../usage/usage-service';

const QUERY_TIMEOUT_MS = 8000;

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
      persistProviderUsage({
        userId: input.userId,
        providerId: chat.provider.id,
        chatId: chat.id,
        messageId: assistantMessage.id,
        operation: 'CHAT_GENERATION',
        model: chat.provider.defaultModel,
        upstreamRequestId: result.upstreamRequestId,
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        totalTokens: result.usage?.totalTokens ?? null,
        requestUnits: result.usage?.requestUnits ?? null,
        latencyMs: result.latencyMs,
        metadata: {
          executionMode: result.decision.mode,
          capabilities: result.capabilities,
          rawUsage: result.usage?.raw ?? null,
        },
      }).catch((usageError) => {
        logger.error('provider_usage_record_failed', {
          chatId: chat.id,
          providerKey: chat.provider.key,
          message: usageError instanceof Error ? usageError.message : 'unknown',
        });
      }),
    );
    logger.info('create_message_provider_request_completed', {
      chatId: chat.id,
      assistantMessageId: assistantMessage.id,
    });
  } catch (error) {
    logger.error('create_message_provider_request_failed', {
      chatId: chat.id,
      providerKey: chat.provider.key,
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
          failureReason: error instanceof Error ? error.message : 'provider-error',
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
    assistantMessage,
    subscription: presentSubscription(updatedSubscription),
  };
}
