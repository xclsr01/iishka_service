import { useEffect, useState } from 'react';
import { apiClient, type Chat, type FileAsset, type Provider, type Subscription } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type ProviderChatState = {
  chat: Chat | null;
  chatsLoaded: boolean;
  messagesLoading: boolean;
  error: string | null;
  pendingFiles: FileAsset[];
};

type CachedProviderChat = {
  chat: Chat | null;
  cachedAt: number;
};

function toUserFacingError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const normalized = error.message.toLowerCase();
  const safeBackendMessages = [
    'the provider request failed',
    'the provider is currently busy',
    'the provider request timed out',
    'temporarily unavailable',
    'unavailable from this deployment region',
    'out of tokens',
    'active subscription required',
  ];

  if (safeBackendMessages.some((hint) => normalized.includes(hint))) {
    return error.message;
  }

  return fallback;
}

function buildOptimisticUserMessage(content: string, pendingFiles: FileAsset[]) {
  return {
    id: `optimistic-user-${crypto.randomUUID()}`,
    role: 'USER' as const,
    content,
    createdAt: new Date().toISOString(),
    attachments: pendingFiles.map((file) => ({ file })),
  };
}

function buildOptimisticAssistantMessage(content: string) {
  return {
    id: `optimistic-assistant-${crypto.randomUUID()}`,
    role: 'ASSISTANT' as const,
    content,
    createdAt: new Date().toISOString(),
    attachments: [],
  };
}

function getProviderChatCacheKey(providerId: string) {
  return `iishka.provider-chat.${providerId}`;
}

function readCachedProviderChat(providerId: string): Chat | null {
  try {
    const raw = localStorage.getItem(getProviderChatCacheKey(providerId));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CachedProviderChat;
    return parsed?.chat ?? null;
  } catch {
    return null;
  }
}

function writeCachedProviderChat(providerId: string, chat: Chat | null) {
  try {
    localStorage.setItem(
      getProviderChatCacheKey(providerId),
      JSON.stringify({
        chat,
        cachedAt: Date.now(),
      } satisfies CachedProviderChat),
    );
  } catch {
    // Ignore cache persistence failures.
  }
}

export function useProviderChat(provider: Provider, subscription: Subscription) {
  const { t } = useLocale();
  const cachedChat = readCachedProviderChat(provider.id);
  const [state, setState] = useState<ProviderChatState>({
    chat: cachedChat,
    chatsLoaded: Boolean(cachedChat),
    messagesLoading: !cachedChat,
    error: null,
    pendingFiles: [],
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const cachedChatId = cachedChat?.id ?? null;
        if (cachedChatId) {
          try {
            const cachedResponse = await apiClient.getChat(cachedChatId);
            if (cachedResponse.chat.providerId !== provider.id) {
              writeCachedProviderChat(provider.id, null);
              throw new Error('Cached chat provider mismatch');
            }

            if (!cancelled) {
              setState((current) => ({
                ...current,
                chat: cachedResponse.chat,
                chatsLoaded: true,
                messagesLoading: false,
                error: null,
              }));
            }
            writeCachedProviderChat(provider.id, cachedResponse.chat);
            return;
          } catch {
            writeCachedProviderChat(provider.id, null);
          }
        }

        const chatsResponse = await apiClient.getChats();
        const existing = chatsResponse.chats.find((candidate) => candidate.providerId === provider.id);

        if (!existing) {
          if (!cancelled) {
            setState((current) => ({
              ...current,
              chat: null,
              chatsLoaded: true,
              messagesLoading: false,
              error: null,
            }));
          }
          writeCachedProviderChat(provider.id, null);
          return;
        }

        const chatResponse = await apiClient.getChat(existing.id);
        if (!cancelled) {
          setState((current) => ({
            ...current,
            chat: chatResponse.chat,
            chatsLoaded: true,
            messagesLoading: false,
            error: null,
          }));
        }
        writeCachedProviderChat(provider.id, chatResponse.chat);
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            error: toUserFacingError(error, t('loadFailed')),
            chatsLoaded: true,
            messagesLoading: false,
          }));
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [provider.id, subscription.hasAccess]);

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }

    try {
      const uploads = Array.from(files);
      for (const file of uploads) {
        const response = await apiClient.uploadFile(file);
        setState((current) => ({
          ...current,
          pendingFiles: [...current.pendingFiles, response.file],
          error: null,
        }));
      }
    } catch (error) {
      setState((current) => ({
        ...current,
        error: toUserFacingError(error, t('fileUploadFailed')),
      }));
    }
  }

  async function sendMessage(content: string) {
    let activeChatId: string | null = state.chat?.id ?? null;

    try {
      let activeChat = state.chat;
      const previousMessages = activeChat?.messages ?? [];
      const optimisticUserMessage = buildOptimisticUserMessage(content, state.pendingFiles);
      const optimisticAssistantMessage = buildOptimisticAssistantMessage(t('thinking'));

      if (!activeChat) {
        const created = await apiClient.createChat(provider.id);
        activeChat = created.chat;
        activeChatId = created.chat.id;
        setState((current) => ({
          ...current,
          chat: {
            ...created.chat,
            messages: [optimisticUserMessage, optimisticAssistantMessage],
          },
          error: null,
        }));
      } else {
        activeChatId = activeChat.id;
        setState((current) => ({
          ...current,
          chat: current.chat
            ? {
                ...current.chat,
                messages: [
                  ...(current.chat.messages ?? []),
                  optimisticUserMessage,
                  optimisticAssistantMessage,
                ],
              }
            : current.chat,
          error: null,
        }));
      }

      const createdMessages = await apiClient.createMessage(activeChat.id, {
        content,
        fileIds: state.pendingFiles.map((file) => file.id),
      });

      const resolvedChat: Chat = {
        ...(activeChat ?? {
          id: activeChatId ?? crypto.randomUUID(),
          title: provider.name,
          providerId: provider.id,
          provider,
        }),
        provider,
        lastMessageAt: createdMessages.assistantMessage.createdAt,
        messages: [...previousMessages, createdMessages.userMessage, createdMessages.assistantMessage],
      };

      writeCachedProviderChat(provider.id, resolvedChat);
      setState((current) => ({
        ...current,
        chat: resolvedChat,
        pendingFiles: [],
        error: null,
      }));

      return createdMessages.subscription;
    } catch (error) {
      if (activeChatId) {
        let refreshedChat: Chat | null = null;
        try {
          const refreshed = await apiClient.getChat(activeChatId);
          refreshedChat = refreshed.chat;
        } catch {
          refreshedChat = null;
        }

        if (refreshedChat) {
          writeCachedProviderChat(provider.id, refreshedChat);
          setState((current) => ({
            ...current,
            chat: refreshedChat,
            pendingFiles: [],
            error: toUserFacingError(error, t('messageFailed')),
          }));
          throw error;
        }
      }

      setState((current) => ({
        ...current,
        error: toUserFacingError(error, t('messageFailed')),
      }));
      throw error;
    }
  }

  function removePendingFile(fileId: string) {
    setState((current) => ({
      ...current,
      pendingFiles: current.pendingFiles.filter((file) => file.id !== fileId),
    }));
  }
  return {
    ...state,
    uploadFiles,
    sendMessage,
    removePendingFile,
  };
}
