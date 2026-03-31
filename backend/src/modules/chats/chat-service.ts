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
import { prisma } from '../../lib/prisma';
import { getProviderAdapter } from '../providers/provider-registry';
import { requireActiveSubscription } from '../subscriptions/subscription-service';

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

  const providers = await prisma.provider.findMany({
    where: {
      id: { in: providerIds },
    },
  });

  return new Map(providers.map((provider) => [provider.id, provider]));
}

async function mapAttachmentsByMessageId(messageIds: string[]) {
  if (messageIds.length === 0) {
    return new Map<string, Array<{ file: FileAsset }>>();
  }

  const attachments = await prisma.messageAttachment.findMany({
    where: {
      messageId: { in: messageIds },
    },
  });

  const fileIds = Array.from(new Set(attachments.map((attachment) => attachment.fileId)));
  const files = fileIds.length
    ? await prisma.fileAsset.findMany({
        where: {
          id: { in: fileIds },
        },
      })
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
    await prisma.provider.findUnique({
      where: { id: chat.providerId },
    }),
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
  const chats = await prisma.chat.findMany({
    where: { userId },
    orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
  });

  const providersById = await mapProvidersById(Array.from(new Set(chats.map((chat) => chat.providerId))));
  const chatIds = chats.map((chat) => chat.id);
  const latestMessages = chatIds.length
    ? await prisma.message.findMany({
        where: {
          chatId: { in: chatIds },
        },
        orderBy: [{ chatId: 'asc' }, { createdAt: 'desc' }],
      })
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
    await prisma.provider.findFirst({
      where: {
        id: providerId,
        status: ProviderStatus.ACTIVE,
      },
    }),
    'Provider not found',
  );

  return prisma.chat.create({
    data: {
      userId,
      providerId: provider.id,
      title: title?.trim() || `${provider.name} chat`,
    },
    include: {
      provider: true,
    },
  });
}

export async function getChatWithMessages(userId: string, chatId: string) {
  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      userId,
    },
  });
  const resolvedChat = assertPresent(chat, 'Chat not found');
  const messages = await prisma.message.findMany({
    where: {
      chatId: resolvedChat.id,
    },
    orderBy: { createdAt: 'asc' },
  });

  return assembleChat(resolvedChat, messages);
}

export async function createMessage(input: {
  userId: string;
  chatId: string;
  content: string;
  fileIds?: string[];
}) {
  const content = input.content.trim();
  if (!content) {
    throw new AppError('Message cannot be empty', 400, 'INVALID_MESSAGE');
  }

  await requireActiveSubscription(input.userId);
  const chat = assertPresent(
    await prisma.chat.findFirst({
      where: {
        id: input.chatId,
        userId: input.userId,
      },
      include: {
        provider: true,
      },
    }),
    'Chat not found',
  );

  const files = input.fileIds?.length
    ? await prisma.fileAsset.findMany({
        where: {
          id: { in: input.fileIds },
          userId: input.userId,
          status: FileStatus.READY,
        },
      })
    : [];

  if ((input.fileIds?.length ?? 0) !== files.length) {
    throw new AppError('Some files are missing or unavailable', 400, 'INVALID_FILE_REFERENCE');
  }

  const userMessage = await prisma.message.create({
    data: {
      chatId: chat.id,
      userId: input.userId,
      role: 'USER',
      content,
    },
  });

  if (files.length > 0) {
    await prisma.messageAttachment.createMany({
      data: files.map((file) => ({
        messageId: userMessage.id,
        fileId: file.id,
      })),
    });
  }

  const attachmentsByMessageId = await mapAttachmentsByMessageId([userMessage.id]);
  const userMessageWithAttachments = {
    ...userMessage,
    attachments: attachmentsByMessageId.get(userMessage.id) ?? [],
  };

  const history = await prisma.message.findMany({
    where: {
      chatId: chat.id,
    },
    orderBy: { createdAt: 'asc' },
  });

  const provider = getProviderAdapter(chat.provider.key);
  const fileNote = attachmentsContext(files);
  let assistantMessage;
  try {
    const result = await provider.generateResponse({
      providerKey: chat.provider.key,
      model: chat.provider.defaultModel,
      messages: mapHistory(history, fileNote),
    });

    assistantMessage = await prisma.message.create({
      data: {
        chatId: chat.id,
        userId: input.userId,
        role: 'ASSISTANT',
        content: result.text,
        status: MessageStatus.COMPLETED,
        providerMeta: result.raw as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    await prisma.message.create({
      data: {
        chatId: chat.id,
        userId: input.userId,
        role: 'ASSISTANT',
        content: 'The provider request failed. Please retry.',
        status: MessageStatus.FAILED,
        failureReason: error instanceof Error ? error.message : 'provider-error',
      },
    });
    throw error;
  }

  await prisma.chat.update({
    where: { id: chat.id },
    data: {
      title: history.length === 1 ? buildTitle(content) : chat.title,
      lastMessageAt: assistantMessage.createdAt,
    },
  });

  return {
    userMessage: userMessageWithAttachments,
    assistantMessage,
  };
}
