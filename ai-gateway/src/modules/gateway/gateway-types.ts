import type { z } from 'zod';
import type {
  asyncJobRequestSchema,
  chatRespondRequestSchema,
  gatewayMessageSchema,
  providerKeySchema,
} from './gateway-validation';

export type GatewayProviderKey = z.infer<typeof providerKeySchema>;
export type GatewayMessage = z.infer<typeof gatewayMessageSchema>;
export type GatewayChatRespondRequest = z.infer<typeof chatRespondRequestSchema>;
export type GatewayAsyncJobRequest = z.infer<typeof asyncJobRequestSchema>;

export type GatewayUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  requestUnits?: number | null;
  raw: Record<string, unknown> | null;
};

export type GatewayChatRespondResponse = {
  provider: GatewayProviderKey;
  model: string;
  text: string;
  upstreamRequestId: string | null;
  usage: GatewayUsage | null;
  raw: Record<string, unknown>;
};

export type GatewayGeneratedImage = {
  index: number;
  mimeType: string;
  filename: string;
  dataBase64: string;
  sizeBytes: number;
};

export type GatewayGeneratedVideo = {
  index: number;
  mimeType: string;
  filename: string;
  sizeBytes: number;
  metadata?: Record<string, unknown> | null;
};

export type GatewayGeneratedFileArtifact = {
  kind: 'file';
  role: 'video' | 'image' | 'audio' | 'other';
  filename: string;
  mimeType: string;
  dataBase64: string;
  sizeBytes: number;
  metadata?: Record<string, unknown> | null;
};

export type GatewayAsyncJobResponse = {
  provider: GatewayProviderKey;
  model: string;
  resultPayload: {
    kind: GatewayAsyncJobRequest['kind'];
    text?: string | null;
    images?: GatewayGeneratedImage[];
    videos?: GatewayGeneratedVideo[];
    raw?: Record<string, unknown> | null;
  };
  artifacts?: GatewayGeneratedFileArtifact[];
  upstreamRequestId: string | null;
  externalJobId: string | null;
  usage: GatewayUsage | null;
};
