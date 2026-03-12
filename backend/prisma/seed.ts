import { PrismaClient, ProviderKey } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.provider.upsert({
    where: { key: ProviderKey.OPENAI },
    update: {
      name: 'ChatGPT',
      slug: 'chatgpt',
      summary: 'Balanced generalist for drafting, coding, and everyday problem solving.',
      description:
        'OpenAI-backed assistant focused on broad general intelligence, coding support, and multimodal product evolution.',
      defaultModel: 'gpt-4.1-mini',
      isFileUploadBeta: true,
    },
    create: {
      key: ProviderKey.OPENAI,
      name: 'ChatGPT',
      slug: 'chatgpt',
      summary: 'Balanced generalist for drafting, coding, and everyday problem solving.',
      description:
        'OpenAI-backed assistant focused on broad general intelligence, coding support, and multimodal product evolution.',
      defaultModel: 'gpt-4.1-mini',
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
      defaultModel: 'claude-3-5-sonnet-latest',
      isFileUploadBeta: true,
    },
    create: {
      key: ProviderKey.ANTHROPIC,
      name: 'Claude',
      slug: 'claude',
      summary: 'Strong long-form reasoning and document analysis assistant.',
      description:
        'Anthropic-backed assistant optimized for nuanced reasoning, writing quality, and large-context conversations.',
      defaultModel: 'claude-3-5-sonnet-latest',
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
      defaultModel: 'gemini-2.0-flash',
      isFileUploadBeta: true,
    },
    create: {
      key: ProviderKey.GEMINI,
      name: 'Gemini',
      slug: 'gemini',
      summary: 'Fast multimodal assistant for search-heavy and product-style workflows.',
      description:
        'Google-backed assistant with strong multimodal tooling and practical speed for lightweight chat experiences.',
      defaultModel: 'gemini-2.0-flash',
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
