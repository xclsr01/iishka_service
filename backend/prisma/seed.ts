import '../src/load-local-env';
import { DEFAULT_MODELS } from '@iishka/model-config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, ProviderKey } from '@prisma/client';

function resolveSeedDatabaseUrl() {
  const connectionString =
    process.env.MIGRATION_DATABASE_URL?.trim() ||
    process.env.DIRECT_URL?.trim() ||
    process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error('Missing MIGRATION_DATABASE_URL, DIRECT_URL, or DATABASE_URL for seed');
  }

  return connectionString;
}

function createAdapter() {
  const databaseUrl = new URL(resolveSeedDatabaseUrl());
  const schema = databaseUrl.searchParams.get('schema') ?? undefined;
  databaseUrl.searchParams.delete('schema');

  return new PrismaPg(
    {
      connectionString: databaseUrl.toString(),
    },
    schema ? { schema } : undefined,
  );
}

const prisma = new PrismaClient({
  adapter: createAdapter(),
});

async function main() {
  await prisma.provider.upsert({
    where: { key: ProviderKey.OPENAI },
    update: {
      name: 'ChatGPT',
      slug: 'chatgpt',
      summary: 'Balanced generalist for drafting, coding, and everyday problem solving.',
      description:
        'OpenAI-backed assistant focused on broad general intelligence, coding support, and multimodal product evolution.',
      defaultModel: DEFAULT_MODELS.OPENAI,
      isFileUploadBeta: true,
    },
    create: {
      key: ProviderKey.OPENAI,
      name: 'ChatGPT',
      slug: 'chatgpt',
      summary: 'Balanced generalist for drafting, coding, and everyday problem solving.',
      description:
        'OpenAI-backed assistant focused on broad general intelligence, coding support, and multimodal product evolution.',
      defaultModel: DEFAULT_MODELS.OPENAI,
      isFileUploadBeta: true,
    },
  });

  await prisma.provider.upsert({
    where: { key: ProviderKey.ANTHROPIC },
    update: {
      name: 'Claude',
      slug: 'claude',
      summary: 'Strong long-form reasoning and document analysis assistant.',
      description:
        'Anthropic-backed assistant optimized for nuanced reasoning, writing quality, and large-context conversations.',
      defaultModel: DEFAULT_MODELS.ANTHROPIC,
      isFileUploadBeta: true,
    },
    create: {
      key: ProviderKey.ANTHROPIC,
      name: 'Claude',
      slug: 'claude',
      summary: 'Strong long-form reasoning and document analysis assistant.',
      description:
        'Anthropic-backed assistant optimized for nuanced reasoning, writing quality, and large-context conversations.',
      defaultModel: DEFAULT_MODELS.ANTHROPIC,
      isFileUploadBeta: true,
    },
  });

  await prisma.provider.upsert({
    where: { key: ProviderKey.GEMINI },
    update: {
      name: 'Gemini',
      slug: 'gemini',
      summary: 'Fast multimodal assistant for search-heavy and product-style workflows.',
      description:
        'Google-backed assistant with strong multimodal tooling and practical speed for lightweight chat experiences.',
      defaultModel: DEFAULT_MODELS.GEMINI,
      isFileUploadBeta: true,
    },
    create: {
      key: ProviderKey.GEMINI,
      name: 'Gemini',
      slug: 'gemini',
      summary: 'Fast multimodal assistant for search-heavy and product-style workflows.',
      description:
        'Google-backed assistant with strong multimodal tooling and practical speed for lightweight chat experiences.',
      defaultModel: DEFAULT_MODELS.GEMINI,
      isFileUploadBeta: true,
    },
  });

  await prisma.provider.upsert({
    where: { key: ProviderKey.NANO_BANANA },
    update: {
      name: 'Nano Banana',
      slug: 'nano-banana',
      summary: 'Google image model for fast generation and visual editing workflows.',
      description:
        'Nano Banana uses Gemini image generation for prompt-based image creation and future image editing flows.',
      defaultModel: DEFAULT_MODELS.NANO_BANANA,
      isFileUploadBeta: true,
    },
    create: {
      key: ProviderKey.NANO_BANANA,
      name: 'Nano Banana',
      slug: 'nano-banana',
      summary: 'Google image model for fast generation and visual editing workflows.',
      description:
        'Nano Banana uses Gemini image generation for prompt-based image creation and future image editing flows.',
      defaultModel: DEFAULT_MODELS.NANO_BANANA,
      isFileUploadBeta: true,
    },
  });

  await prisma.provider.upsert({
    where: { key: ProviderKey.VEO },
    update: {
      name: 'Veo',
      slug: 'veo',
      summary: 'Google video model for short cinematic prompt-based generation.',
      description:
        'Veo uses Gemini video generation for short-form video creation through an async workflow.',
      defaultModel: DEFAULT_MODELS.VEO,
      isFileUploadBeta: true,
    },
    create: {
      key: ProviderKey.VEO,
      name: 'Veo',
      slug: 'veo',
      summary: 'Google video model for short cinematic prompt-based generation.',
      description:
        'Veo uses Gemini video generation for short-form video creation through an async workflow.',
      defaultModel: DEFAULT_MODELS.VEO,
      isFileUploadBeta: true,
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
