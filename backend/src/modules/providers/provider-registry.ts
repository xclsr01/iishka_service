import { ProviderKey } from '@prisma/client';
import { AppError } from '../../lib/errors';
import { AnthropicProviderAdapter } from './anthropic-provider';
import { GeminiProviderAdapter } from './gemini-provider';
import { OpenAiProviderAdapter } from './openai-provider';
import type { AiProviderAdapter, ProviderAdapterMetadata, ProviderCapabilitySet } from './provider-types';

export type RegisteredProvider = {
  key: ProviderKey;
  adapter: AiProviderAdapter;
  metadata: ProviderAdapterMetadata;
};

const openAiAdapter = new OpenAiProviderAdapter();
const anthropicAdapter = new AnthropicProviderAdapter();
const geminiAdapter = new GeminiProviderAdapter();

const registry = new Map<ProviderKey, RegisteredProvider>([
  [
    ProviderKey.OPENAI,
    {
      key: ProviderKey.OPENAI,
      adapter: openAiAdapter,
      metadata: openAiAdapter.metadata,
    },
  ],
  [
    ProviderKey.ANTHROPIC,
    {
      key: ProviderKey.ANTHROPIC,
      adapter: anthropicAdapter,
      metadata: anthropicAdapter.metadata,
    },
  ],
  [
    ProviderKey.GEMINI,
    {
      key: ProviderKey.GEMINI,
      adapter: geminiAdapter,
      metadata: geminiAdapter.metadata,
    },
  ],
]);

export function getRegisteredProvider(providerKey: ProviderKey) {
  const provider = registry.get(providerKey);
  if (!provider) {
    throw new AppError('Provider not configured', 500, 'PROVIDER_NOT_CONFIGURED');
  }

  return provider;
}

export function getProviderAdapter(providerKey: ProviderKey) {
  return getRegisteredProvider(providerKey).adapter;
}

export function getProviderCapabilities(providerKey: ProviderKey): ProviderCapabilitySet {
  return getRegisteredProvider(providerKey).metadata.capabilities;
}

export function listRegisteredProviders() {
  return Array.from(registry.values());
}
