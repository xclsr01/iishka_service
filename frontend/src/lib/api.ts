import { clientEnv } from './env';

export type Provider = {
  id: string;
  key: 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'NANO_BANANA';
  name: string;
  slug: string;
  summary: string;
  description: string;
  defaultModel: string;
  isFileUploadBeta: boolean;
  isAvailable: boolean;
  availabilityMessage?: string | null;
  capabilities?: {
    supportsText: boolean;
    supportsImage: boolean;
    supportsStreaming: boolean;
    supportsAsyncJobs: boolean;
    supportsFiles: boolean;
  };
  executionMode?: 'interactive' | 'streaming' | 'async-job';
};

export type User = {
  id: string;
  telegramUserId: string;
  telegramUsername?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
};

export type Subscription = {
  id: string;
  status: string;
  planCode: string;
  currentPeriodEnd?: string | null;
  tokensAllowed: number;
  tokensUsed: number;
  tokensRemaining: number;
  hasAccess: boolean;
};

export type FileAsset = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  createdAt: string;
  attachments?: Array<{
    file: FileAsset;
  }>;
};

export type Chat = {
  id: string;
  title: string;
  providerId: string;
  lastMessageAt?: string | null;
  provider: Provider;
  messages?: ChatMessage[];
};

export type BootstrapResponse = {
  token: string;
  user: User;
  providers: Provider[];
  subscription: Subscription;
};

type ApiErrorPayload = {
  error?: {
    message?: string;
  };
};

class ApiClient {
  private token: string | null = localStorage.getItem('iishka.token');

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('iishka.token', token);
    } else {
      localStorage.removeItem('iishka.token');
    }
  }

  getToken() {
    return this.token;
  }

  private async request<T>(path: string, init?: RequestInit) {
    const response = await fetch(`${clientEnv.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
    });

    if (!response.ok) {
      const rawText = await response.text().catch(() => '');
      let payload: ApiErrorPayload | null = null;

      try {
        payload = rawText ? (JSON.parse(rawText) as ApiErrorPayload) : null;
      } catch {
        payload = null;
      }

      throw new Error(
        payload?.error?.message ??
          (rawText || `Request failed with status ${response.status}`),
      );
    }

    return (await response.json()) as T;
  }

  bootstrapTelegram(initDataRaw: string) {
    return this.request<BootstrapResponse>('/api/auth/telegram/bootstrap', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ initDataRaw }),
    });
  }

  bootstrapDev() {
    return this.request<BootstrapResponse>('/api/auth/dev/bootstrap', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sharedSecret: clientEnv.devAuthSharedSecret,
      }),
    });
  }

  getProviders() {
    return this.request<{ providers: Provider[] }>('/api/catalog/providers');
  }

  getChats() {
    return this.request<{ chats: Chat[] }>('/api/chats');
  }

  createChat(providerId: string) {
    return this.request<{ chat: Chat }>('/api/chats', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ providerId }),
    });
  }

  getChat(chatId: string) {
    return this.request<{ chat: Chat }>('/api/chats/' + chatId + '/messages');
  }

  createMessage(chatId: string, payload: { content: string; fileIds?: string[] }) {
    return this.request<{
      userMessage: ChatMessage;
      assistantMessage: ChatMessage;
      subscription: Subscription;
    }>(`/api/chats/${chatId}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }

  uploadFile(file: File) {
    const formData = new FormData();
    formData.append('file', file);

    return this.request<{ file: FileAsset }>('/api/files', {
      method: 'POST',
      body: formData,
    });
  }

  getSubscription() {
    return this.request<{ subscription: Subscription }>('/api/subscription');
  }

  activateDevSubscription() {
    return this.request<{ subscription: Subscription }>('/api/subscription/dev/activate', {
      method: 'POST',
    });
  }

  unsubscribeDevSubscription() {
    return this.request<{ subscription: Subscription }>('/api/subscription/dev/unsubscribe', {
      method: 'POST',
    });
  }
}

export const apiClient = new ApiClient();
