import { ProviderKey } from '@prisma/client';
import { AppError } from '../../lib/errors';
import { env } from '../../env';
import { AnthropicProviderAdapter } from './anthropic-provider';
import { GeminiProviderAdapter } from './gemini-provider';
import { NanoBananaProviderAdapter } from './nano-banana-provider';
import { OpenAiProviderAdapter } from './openai-provider';
import { VeoProviderAdapter } from './veo-provider';
import type { AiProviderAdapter, ProviderAdapterMetadata, ProviderCapabilitySet } from './provider-types';

export type RegisteredProvider = {
  key: ProviderKey;
  adapter: AiProviderAdapter;
  metadata: ProviderAdapterMetadata;
};

const openAiAdapter = new OpenAiProviderAdapter();
const anthropicAdapter = new AnthropicProviderAdapter();
const geminiAdapter = new GeminiProviderAdapter();
const nanoBananaAdapter = new NanoBananaProviderAdapter();
const veoAdapter = new VeoProviderAdapter();

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
  [
    ProviderKey.NANO_BANANA,
    {
      key: ProviderKey.NANO_BANANA,
      adapter: nanoBananaAdapter,
      metadata: nanoBananaAdapter.metadata,
    },
  ],
  [
    ProviderKey.VEO,
    {
      key: ProviderKey.VEO,
      adapter: veoAdapter,
      metadata: veoAdapter.metadata,
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

export function getProviderRuntimeModel(providerKey: ProviderKey) {
  switch (providerKey) {
    case ProviderKey.OPENAI:
      return env.OPENAI_MODEL;
    case ProviderKey.ANTHROPIC:
      return env.ANTHROPIC_MODEL;
    case ProviderKey.GEMINI:
      return env.GOOGLE_AI_MODEL;
    case ProviderKey.NANO_BANANA:
      return env.NANO_BANANA_MODEL;
    case ProviderKey.VEO:
      return env.VEO_MODEL;
    default:
      throw new AppError('Provider runtime model not configured', 500, 'PROVIDER_MODEL_NOT_CONFIGURED');
  }
}
