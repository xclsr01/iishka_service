import type { z } from 'zod';
import type { chatRespondRequestSchema } from './openai-validation';

export type GatewayMessageRole = 'system' | 'user' | 'assistant';

export type GatewayChatMessage = {
  role: GatewayMessageRole;
  content: string;
};

export type GatewayChatRespondRequest = z.infer<typeof chatRespondRequestSchema>;

export type GatewayUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  raw: Record<string, unknown> | null;
};

export type GatewayChatRespondResponse = {
  text: string;
  upstreamRequestId: string | null;
  usage: GatewayUsage | null;
  raw: {
    id: string | null;
    model: string;
    responseStatus: string | null;
  };
};
