import type {
  GenerationJob,
  GenerationJobKind,
  GenerationJobStatus,
  Provider,
  ProviderKey,
} from '@prisma/client';

export type CreateGenerationJobInput = {
  userId: string;
  providerId: string;
  kind: GenerationJobKind;
  prompt: string;
  chatId?: string;
  metadata?: Record<string, unknown>;
};

export type ListGenerationJobsInput = {
  userId: string;
  providerId?: string;
  kind?: GenerationJobKind;
  status?: GenerationJobStatus;
  limit?: number;
};

export type EnqueueGenerationJobInput = {
  jobId: string;
  providerKey: ProviderKey;
  kind: GenerationJobKind;
  prompt: string;
  chatId?: string;
  metadata?: Record<string, unknown>;
};

export type BackgroundTaskScheduler = (task: Promise<unknown>) => void;

export type EnqueueGenerationJobOptions = {
  schedule?: BackgroundTaskScheduler;
  onSettled?: () => Promise<void>;
};

export type PresentedGenerationJob = {
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
    key: ProviderKey;
    name: string;
    slug: string;
    defaultModel: string;
  };
  resultPayload: unknown;
};

export type PresentedGenerationJobImageLinks = {
  openUrl: string;
  downloadUrl: string;
  expiresAt: string;
};

export type GenerationJobRecord = GenerationJob & {
  provider: Provider;
};
