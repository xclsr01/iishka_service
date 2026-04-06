import { ProviderKey, type Provider } from '@prisma/client';
import { env } from '../../env';
import { getRegisteredProvider } from './provider-registry';
import type { ProviderCapabilitySet, ProviderExecutionMode } from './provider-types';

type PresentedProvider = Provider & {
  isAvailable: boolean;
  availabilityMessage: string | null;
  capabilities: ProviderCapabilitySet;
  executionMode: ProviderExecutionMode;
};

export function presentProvider(provider: Provider): PresentedProvider {
  const registeredProvider = getRegisteredProvider(provider.key);

  if (provider.key === ProviderKey.OPENAI && !env.OPENAI_ENABLED) {
    return {
      ...provider,
      isAvailable: false,
      availabilityMessage:
        'ChatGPT is temporarily unavailable in this deployment region. Use Claude or Gemini, or route OpenAI through a separate proxy/server in a supported region.',
      capabilities: registeredProvider.metadata.capabilities,
      executionMode: registeredProvider.metadata.executionMode,
    };
  }

  return {
    ...provider,
    isAvailable: true,
    availabilityMessage: null,
    capabilities: registeredProvider.metadata.capabilities,
    executionMode: registeredProvider.metadata.executionMode,
  };
}

export function presentProviders(providers: Provider[]) {
  return providers.map(presentProvider);
}
