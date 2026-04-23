import { ProviderKey, ProviderStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { getProviderRuntimeModel, listRegisteredProviders } from './provider-registry';

const providerCatalogCopy: Record<
  ProviderKey,
  {
    name: string;
    slug: string;
    summary: string;
    description: string;
  }
> = {
  OPENAI: {
    name: 'ChatGPT',
    slug: 'chatgpt',
    summary: 'Balanced generalist for drafting, coding, and everyday problem solving.',
    description:
      'OpenAI-backed assistant focused on broad general intelligence, coding support, and multimodal product evolution.',
  },
  ANTHROPIC: {
    name: 'Claude',
    slug: 'claude',
    summary: 'Strong long-form reasoning and document analysis assistant.',
    description:
      'Anthropic-backed assistant optimized for nuanced reasoning, writing quality, and large-context conversations.',
  },
  GEMINI: {
    name: 'Gemini',
    slug: 'gemini',
    summary: 'Fast multimodal assistant for search-heavy and product-style workflows.',
    description:
      'Google-backed assistant with strong multimodal tooling and practical speed for lightweight chat experiences.',
  },
  NANO_BANANA: {
    name: 'Nano Banana',
    slug: 'nano-banana',
    summary: 'Google image model for fast generation and visual editing workflows.',
    description:
      'Nano Banana uses Gemini image generation for prompt-based image creation and future image editing flows.',
  },
  VEO: {
    name: 'Veo',
    slug: 'veo',
    summary: 'Google video model for short cinematic prompt-based generation.',
    description:
      'Veo uses Gemini video generation for short-form video creation through an async workflow.',
  },
};

export async function ensureRegisteredProvidersSeeded() {
  const registeredProviders = listRegisteredProviders();

  await prisma.$transaction(
    registeredProviders.map((registeredProvider) => {
      const copy = providerCatalogCopy[registeredProvider.key];

      return prisma.provider.upsert({
        where: {
          key: registeredProvider.key,
        },
        update: {
          name: copy.name,
          slug: copy.slug,
          summary: copy.summary,
          description: copy.description,
          defaultModel: getProviderRuntimeModel(registeredProvider.key),
          status: ProviderStatus.ACTIVE,
          isFileUploadBeta: true,
        },
        create: {
          key: registeredProvider.key,
          name: copy.name,
          slug: copy.slug,
          summary: copy.summary,
          description: copy.description,
          defaultModel: getProviderRuntimeModel(registeredProvider.key),
          status: ProviderStatus.ACTIVE,
          isFileUploadBeta: true,
        },
      });
    }),
  );
}
