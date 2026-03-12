import { ProviderKey } from '@prisma/client';
import { AppError } from '../../lib/errors';
import { AnthropicProviderAdapter } from './anthropic-provider';
import { GeminiProviderAdapter } from './gemini-provider';
import { OpenAiProviderAdapter } from './openai-provider';
import type { AiProviderAdapter } from './provider-types';

const registry = new Map<ProviderKey, AiProviderAdapter>([
  [ProviderKey.OPENAI, new OpenAiProviderAdapter()],
  [ProviderKey.ANTHROPIC, new AnthropicProviderAdapter()],
  [ProviderKey.GEMINI, new GeminiProviderAdapter()],
]);

export function getProviderAdapter(providerKey: ProviderKey) {
  const adapter = registry.get(providerKey);
  if (!adapter) {
    throw new AppError('Provider not configured', 500, 'PROVIDER_NOT_CONFIGURED');
  }

  return adapter;
}
