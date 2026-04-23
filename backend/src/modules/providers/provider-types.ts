import type { GenerationJobKind, ProviderKey } from '@prisma/client';
import { AppError } from '../../lib/errors';

export type ProviderChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ProviderExecutionMode = 'interactive' | 'streaming' | 'async-job';

export type ProviderCapabilitySet = {
  supportsText: boolean;
  supportsImage: boolean;
  supportsStreaming: boolean;
  supportsAsyncJobs: boolean;
  supportsFiles: boolean;
};

export type ProviderUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  requestUnits?: number | null;
  raw?: Record<string, unknown> | null;
};

export type ProviderGenerateInput = {
  providerKey: ProviderKey;
  model: string;
  messages: ProviderChatMessage[];
  chatId?: string;
  userId?: string;
};

export type ProviderGenerateResult = {
  text: string;
  raw: Record<string, unknown>;
  usage: ProviderUsage | null;
  upstreamRequestId: string | null;
};

export type ProviderAsyncJobInput = {
  providerKey: ProviderKey;
  jobId: string;
  kind: GenerationJobKind;
  model: string;
  prompt: string;
  chatId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
};

export type ProviderGeneratedFileArtifact = {
  kind: 'file';
  role: 'video' | 'image' | 'audio' | 'other';
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  sizeBytes: number;
  metadata?: Record<string, unknown> | null;
};

export type ProviderAsyncJobResult = {
  resultPayload: Record<string, unknown>;
  artifacts?: ProviderGeneratedFileArtifact[];
  usage: ProviderUsage | null;
  upstreamRequestId: string | null;
  externalJobId: string | null;
};

export type ProviderErrorCategory =
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'auth'
  | 'bad_request'
  | 'region_unavailable'
  | 'service_unavailable'
  | 'upstream'
  | 'empty_response'
  | 'unknown';

export class ProviderAdapterError extends AppError {
  readonly providerKey: ProviderKey;
  readonly category: ProviderErrorCategory;
  readonly retryable: boolean;
  readonly upstreamStatus?: number;
  readonly upstreamRequestId?: string | null;

  constructor(input: {
    providerKey: ProviderKey;
    message: string;
    code: string;
    category: ProviderErrorCategory;
    retryable: boolean;
    statusCode?: number;
    details?: unknown;
    upstreamStatus?: number;
    upstreamRequestId?: string | null;
  }) {
    super(input.message, input.statusCode ?? 502, input.code, input.details);
    this.name = 'ProviderAdapterError';
    this.providerKey = input.providerKey;
    this.category = input.category;
    this.retryable = input.retryable;
    this.upstreamStatus = input.upstreamStatus;
    this.upstreamRequestId = input.upstreamRequestId;
  }
}

export type ProviderAdapterMetadata = {
  key: ProviderKey;
  executionMode: ProviderExecutionMode;
  capabilities: ProviderCapabilitySet;
};

export interface AiProviderAdapter {
  readonly metadata: ProviderAdapterMetadata;
  generateResponse(input: ProviderGenerateInput): Promise<ProviderGenerateResult>;
  executeAsyncJob?(input: ProviderAsyncJobInput): Promise<ProviderAsyncJobResult>;
  classifyError(error: unknown): ProviderAdapterError;
}
