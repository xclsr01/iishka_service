import { clientEnv } from './env';

const TOKEN_STORAGE_KEY = `iishka.token.${clientEnv.apiBaseUrl}`;

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

export type GenerationJobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';

export type GenerationJobKind = 'IMAGE' | 'MUSIC' | 'VIDEO' | 'PROVIDER_ASYNC';

export type GeneratedImage = {
  index: number;
  mimeType: string;
  filename: string;
  dataBase64: string;
  sizeBytes: number;
};

export type ImageJobResultPayload = {
  kind: 'IMAGE';
  text?: string | null;
  images?: GeneratedImage[];
};

export type GenerationJobImageLinks = {
  openUrl: string;
  downloadUrl: string;
  filename: string;
  mimeType: string;
  disposition: 'inline';
  open?: {
    url: string;
    filename: string;
    mimeType: string;
    disposition: 'inline';
  };
  download?: {
    url: string;
    filename: string;
    mimeType: string;
    disposition: 'attachment';
  };
  expiresAt: string;
};

export type GenerationJob = {
  id: string;
  kind: GenerationJobKind;
  status: GenerationJobStatus;
  prompt: string;
  failureCode: string | null;
  failureMessage: string | null;
  externalJobId: string | null;
  providerRequestId: string | null;
  attemptCount: number;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  chatId: string | null;
  provider: {
    id: string;
    key: Provider['key'];
    name: string;
    slug: string;
    defaultModel: string;
  };
  resultPayload: unknown;
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
  private token: string | null = localStorage.getItem(TOKEN_STORAGE_KEY);

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  }

  getToken() {
    if (this.token) {
      return this.token;
    }

    this.token = localStorage.getItem(TOKEN_STORAGE_KEY);
    return this.token;
  }

  private async request<T>(path: string, init?: RequestInit) {
    const token = this.getToken();
    const isBootstrapRequest = path.startsWith('/api/auth/');

    if (!token && !isBootstrapRequest) {
      throw new Error('Auth session is not ready. Please reopen the Mini App.');
    }

    const response = await fetch(`${clientEnv.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
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

    if (response.status === 204) {
      return undefined as T;
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

  createGenerationJob(payload: {
    providerId: string;
    kind: GenerationJobKind;
    prompt: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.request<{ job: GenerationJob }>('/api/jobs', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }

  getGenerationJob(jobId: string) {
    return this.request<{ job: GenerationJob }>(`/api/jobs/${jobId}`);
  }

  deleteGenerationJob(jobId: string) {
    return this.request<void>(`/api/jobs/${jobId}`, {
      method: 'DELETE',
    });
  }

  getGenerationJobImageLinks(jobId: string, imageIndex: number) {
    return this.request<GenerationJobImageLinks>(`/api/jobs/${jobId}/images/${imageIndex}/links`);
  }

  getGenerationJobs(params?: {
    providerId?: string;
    kind?: GenerationJobKind;
    status?: GenerationJobStatus;
    limit?: number;
  }) {
    const searchParams = new URLSearchParams();

    if (params?.providerId) {
      searchParams.set('providerId', params.providerId);
    }

    if (params?.kind) {
      searchParams.set('kind', params.kind);
    }

    if (params?.status) {
      searchParams.set('status', params.status);
    }

    if (params?.limit) {
      searchParams.set('limit', String(params.limit));
    }

    const query = searchParams.toString();
    return this.request<{ jobs: GenerationJob[] }>(`/api/jobs${query ? `?${query}` : ''}`);
  }
}

export const apiClient = new ApiClient();
