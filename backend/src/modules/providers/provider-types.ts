import type { ProviderKey } from '@prisma/client';

export type ProviderChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ProviderGenerateInput = {
  providerKey: ProviderKey;
  model: string;
  messages: ProviderChatMessage[];
};

export type ProviderGenerateResult = {
  text: string;
  raw: Record<string, unknown>;
};

export interface AiProviderAdapter {
  generateResponse(input: ProviderGenerateInput): Promise<ProviderGenerateResult>;
}
