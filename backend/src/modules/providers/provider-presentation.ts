import { ProviderKey, type Provider } from '@prisma/client';
import { env } from '../../env';

type PresentedProvider = Provider & {
  isAvailable: boolean;
  availabilityMessage: string | null;
};

export function presentProvider(provider: Provider): PresentedProvider {
  if (provider.key === ProviderKey.OPENAI && !env.OPENAI_ENABLED) {
    return {
      ...provider,
      isAvailable: false,
      availabilityMessage:
        'ChatGPT is temporarily unavailable in this deployment region. Use Claude or Gemini, or route OpenAI through a separate proxy/server in a supported region.',
    };
  }

  return {
    ...provider,
    isAvailable: true,
    availabilityMessage: null,
  };
}

export function presentProviders(providers: Provider[]) {
  return providers.map(presentProvider);
}
