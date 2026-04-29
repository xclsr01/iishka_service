import { useEffect, useRef, useState } from 'react';
import {
  apiClient,
  type Chat,
  type FileAsset,
  type Provider,
  type Subscription,
} from '@/lib/api';
import { clientEnv } from '@/lib/env';
import { useLocale } from '@/lib/i18n';

type ProviderChatState = {
  chat: Chat | null;
  chatsLoaded: boolean;
  messagesLoading: boolean;
  olderMessagesLoading: boolean;
  error: string | null;
  pendingFiles: FileAsset[];
};

type CachedProviderChat = {
  chat: Chat | null;
  cachedAt: number;
};

const ASYNC_CHAT_HISTORY_PAGE_SIZE = 20;

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
    'auth session is not ready',
    'failed to fetch',
    'networkerror',
    'load failed',
    'out of tokens',
    'active subscription required',
  ];

  if (safeBackendMessages.some((hint) => normalized.includes(hint))) {
    return error.message;
  }

  return fallback;
}

function buildOptimisticUserMessage(
  content: string,
  pendingFiles: FileAsset[],
) {
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

function isPendingAsyncMessage(chat: Chat | null) {
  if (!chat?.messages?.length) {
    return false;
  }

  return chat.messages.some((message) => {
    if (message.status === 'STREAMING') {
      return true;
    }

    const providerMeta = message.providerMeta;
    if (
      !providerMeta ||
      typeof providerMeta !== 'object' ||
      Array.isArray(providerMeta)
    ) {
      return false;
    }

    return (
      providerMeta.executionMode === 'async_job' &&
      (providerMeta.status === 'QUEUED' || providerMeta.status === 'RUNNING')
    );
  });
}

function getProviderChatCacheKey(providerId: string) {
  return `iishka.provider-chat.${clientEnv.apiBaseUrl}.${providerId}`;
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

function mergeMessages(
  existing: Chat['messages'] = [],
  incoming: Chat['messages'] = [],
) {
  const byId = new Map(existing.map((message) => [message.id, message]));

  for (const message of incoming) {
    byId.set(message.id, message);
  }

  return Array.from(byId.values()).sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

export function useProviderChat(
  provider: Provider,
  subscription: Subscription,
  onSubscriptionChange: (subscription: Subscription) => void,
) {
  const { t } = useLocale();
  const shouldPaginateHistory = provider.executionMode === 'async-job';
  const cachedChat = readCachedProviderChat(provider.id);
  const initialChat = shouldPaginateHistory ? null : cachedChat;
  const pendingAsyncMessageRef = useRef(isPendingAsyncMessage(initialChat));
  const [state, setState] = useState<ProviderChatState>({
    chat: initialChat,
    chatsLoaded: Boolean(initialChat),
    messagesLoading: !initialChat,
    olderMessagesLoading: false,
    error: null,
    pendingFiles: [],
  });

  function getChatPage(chatId: string, cursor?: string) {
    return apiClient.getChat(
      chatId,
      shouldPaginateHistory
        ? { limit: ASYNC_CHAT_HISTORY_PAGE_SIZE, cursor }
        : undefined,
    );
  }

  async function refreshChat(
    chatId: string,
    options: { merge?: boolean } = {},
  ) {
    const response = await getChatPage(chatId);
    const nextChat =
      options.merge && state.chat
        ? {
            ...response.chat,
            messages: mergeMessages(
              state.chat.messages,
              response.chat.messages,
            ),
            messagesNextCursor:
              state.chat.messagesNextCursor ?? response.chat.messagesNextCursor,
          }
        : response.chat;

    writeCachedProviderChat(provider.id, nextChat);
    setState((current) => ({
      ...current,
      chat: nextChat,
      error: null,
    }));
    return nextChat;
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const cachedChatId = cachedChat?.id ?? null;
        if (cachedChatId) {
          try {
            const cachedResponse = await getChatPage(cachedChatId);
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
        const existing = chatsResponse.chats.find(
          (candidate) => candidate.providerId === provider.id,
        );

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

        const chatResponse = await getChatPage(existing.id);
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

  useEffect(() => {
    const hasPendingAsyncMessage = isPendingAsyncMessage(state.chat);
    const hadPendingAsyncMessage = pendingAsyncMessageRef.current;
    pendingAsyncMessageRef.current = hasPendingAsyncMessage;

    if (!state.chat?.id || !hasPendingAsyncMessage) {
      if (hadPendingAsyncMessage && provider.executionMode === 'async-job') {
        apiClient
          .getSubscription()
          .then((response) => onSubscriptionChange(response.subscription))
          .catch(() => undefined);
      }
      return;
    }

    let cancelled = false;
    const intervalId = window.setInterval(() => {
      getChatPage(state.chat!.id)
        .then((response) => {
          if (cancelled) {
            return;
          }

          const nextChat = shouldPaginateHistory
            ? {
                ...response.chat,
                messages: mergeMessages(
                  state.chat?.messages,
                  response.chat.messages,
                ),
                messagesNextCursor:
                  state.chat?.messagesNextCursor ??
                  response.chat.messagesNextCursor,
              }
            : response.chat;

          writeCachedProviderChat(provider.id, nextChat);
          setState((current) => ({
            ...current,
            chat: nextChat,
            error: null,
          }));
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }

          setState((current) => ({
            ...current,
            error: toUserFacingError(error, t('loadFailed')),
          }));
        });
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    onSubscriptionChange,
    provider.executionMode,
    provider.id,
    state.chat,
    t,
  ]);

  async function loadOlderMessages() {
    if (
      !shouldPaginateHistory ||
      !state.chat?.id ||
      !state.chat.messagesNextCursor ||
      state.olderMessagesLoading
    ) {
      return;
    }

    try {
      setState((current) => ({
        ...current,
        olderMessagesLoading: true,
        error: null,
      }));

      const response = await getChatPage(
        state.chat.id,
        state.chat.messagesNextCursor,
      );

      setState((current) => {
        if (!current.chat) {
          return {
            ...current,
            olderMessagesLoading: false,
          };
        }

        const nextChat = {
          ...current.chat,
          messages: mergeMessages(
            response.chat.messages,
            current.chat.messages,
          ),
          messagesNextCursor: response.chat.messagesNextCursor,
        };

        writeCachedProviderChat(provider.id, nextChat);

        return {
          ...current,
          chat: nextChat,
          olderMessagesLoading: false,
          error: null,
        };
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        olderMessagesLoading: false,
        error: toUserFacingError(error, t('loadFailed')),
      }));
    }
  }

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
      const optimisticUserMessage = buildOptimisticUserMessage(
        content,
        state.pendingFiles,
      );
      const optimisticAssistantMessage = buildOptimisticAssistantMessage(
        t('thinking'),
      );

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
        messagesNextCursor: activeChat?.messagesNextCursor ?? null,
        messages: [
          ...previousMessages,
          createdMessages.userMessage,
          createdMessages.assistantMessage,
        ],
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
          const refreshed = await getChatPage(activeChatId);
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

  async function retryAsyncMessage(messageId: string) {
    if (!state.chat?.id) {
      throw new Error(t('loadFailed'));
    }

    try {
      await apiClient.retryChatMessage(state.chat.id, messageId);
      await refreshChat(state.chat.id);
    } catch (error) {
      const userFacingError = toUserFacingError(error, t('retryVideoFailed'));
      setState((current) => ({
        ...current,
        error: userFacingError,
      }));
      throw new Error(userFacingError);
    }
  }

  async function deleteAsyncMessage(messageId: string) {
    if (!state.chat?.id) {
      throw new Error(t('loadFailed'));
    }

    try {
      await apiClient.deleteChatMessage(state.chat.id, messageId);
      await refreshChat(state.chat.id);
    } catch (error) {
      const userFacingError = toUserFacingError(error, t('deleteVideoFailed'));
      setState((current) => ({
        ...current,
        error: userFacingError,
      }));
      throw new Error(userFacingError);
    }
  }

  return {
    ...state,
    uploadFiles,
    sendMessage,
    loadOlderMessages,
    removePendingFile,
    retryAsyncMessage,
    deleteAsyncMessage,
  };
}
