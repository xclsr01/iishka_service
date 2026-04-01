import { useEffect, useState } from 'react';
import { apiClient, type Chat, type FileAsset, type Provider, type Subscription } from '@/lib/api';

type ProviderChatState = {
  chat: Chat | null;
  chatsLoaded: boolean;
  messagesLoading: boolean;
  error: string | null;
  pendingFiles: FileAsset[];
};

function toUserFacingError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const providerFailureHints = [
    'request failed',
    'provider',
    'quota',
    'resource_exhausted',
    'temporarily unavailable',
    'unsupported_country_region_territory',
    'operation timed out',
  ];

  const normalized = error.message.toLowerCase();
  if (providerFailureHints.some((hint) => normalized.includes(hint))) {
    return null;
  }

  return fallback;
}

export function useProviderChat(provider: Provider, subscription: Subscription) {
  const [state, setState] = useState<ProviderChatState>({
    chat: null,
    chatsLoaded: false,
    messagesLoading: true,
    error: null,
    pendingFiles: [],
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
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
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            error: toUserFacingError(error, 'Load failed'),
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
        error: toUserFacingError(error, 'File upload failed'),
      }));
    }
  }

  async function sendMessage(content: string) {
    try {
      let activeChat = state.chat;

      if (!activeChat) {
        const created = await apiClient.createChat(provider.id);
        activeChat = created.chat;
      }

      await apiClient.createMessage(activeChat.id, {
        content,
        fileIds: state.pendingFiles.map((file) => file.id),
      });

      const refreshed = await apiClient.getChat(activeChat.id);
      setState((current) => ({
        ...current,
        chat: refreshed.chat,
        pendingFiles: [],
        error: null,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        error: toUserFacingError(error, 'Message failed'),
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
