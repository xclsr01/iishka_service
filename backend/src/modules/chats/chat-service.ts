import { FileStatus, type FileAsset, type MessageRole, MessageStatus, ProviderStatus } from '@prisma/client';
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

export async function listChats(userId: string) {
  return prisma.chat.findMany({
    where: { userId },
    include: {
      provider: true,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
  });
}

export async function createChat(userId: string, providerId: string, title?: string) {
  const provider = await prisma.provider.findFirst({
    where: {
      id: providerId,
      status: ProviderStatus.ACTIVE,
    },
  });

  assertPresent(provider, 'Provider not found');

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
    include: {
      provider: true,
      messages: {
        orderBy: { createdAt: 'asc' },
        include: {
          attachments: {
            include: {
              file: true,
            },
          },
        },
      },
    },
  });

  return assertPresent(chat, 'Chat not found');
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
  const chat = await prisma.chat.findFirst({
    where: {
      id: input.chatId,
      userId: input.userId,
    },
    include: {
      provider: true,
    },
  });

  assertPresent(chat, 'Chat not found');

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
      attachments: files.length
        ? {
            createMany: {
              data: files.map((file) => ({
                fileId: file.id,
              })),
            },
          }
        : undefined,
    },
    include: {
      attachments: {
        include: {
          file: true,
        },
      },
    },
  });

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
        providerMeta: result.raw,
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
    userMessage,
    assistantMessage,
  };
}
