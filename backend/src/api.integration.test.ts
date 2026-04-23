import test, { after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GenerationJobKind, ProviderKey, ProviderStatus } from '@prisma/client';
import { createApp } from './app';
import { prisma } from './lib/prisma';
import { env } from './env';
import { getRegisteredProvider } from './modules/providers/provider-registry';
import type {
  ProviderAsyncJobResult,
  ProviderGenerateResult,
} from './modules/providers/provider-types';

type BootstrapResponse = {
  token: string;
  user: {
    id: string;
    telegramUserId: string;
  };
  providers: Array<{
    id: string;
    key: ProviderKey;
    name: string;
    isAvailable: boolean;
    executionMode: string;
    capabilities: {
      supportsText: boolean;
      supportsImage: boolean;
      supportsFiles: boolean;
      supportsAsyncJobs: boolean;
    };
  }>;
  subscription: {
    id: string;
    status: string;
    tokensAllowed: number;
    tokensUsed: number;
    tokensRemaining: number;
    hasAccess: boolean;
  };
};

const restoreCallbacks: Array<() => void> = [];

function trackRestore(restore: () => void) {
  restoreCallbacks.push(restore);
}

async function clearDatabase() {
  await prisma.providerUsage.deleteMany();
  await prisma.messageAttachment.deleteMany();
  await prisma.message.deleteMany();
  await prisma.generationJob.deleteMany();
  await prisma.fileAsset.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.chat.deleteMany();
  await prisma.user.deleteMany();
  await prisma.provider.deleteMany();
}

async function seedProviders() {
  await prisma.provider.createMany({
    data: [
      {
        key: ProviderKey.OPENAI,
        name: 'ChatGPT',
        slug: 'chatgpt',
        summary: 'Balanced generalist for drafting, coding, and everyday problem solving.',
        description:
          'OpenAI-backed assistant focused on broad general intelligence, coding support, and multimodal product evolution.',
        defaultModel: 'gpt-5.4-mini',
        status: ProviderStatus.ACTIVE,
        isFileUploadBeta: true,
      },
      {
        key: ProviderKey.ANTHROPIC,
        name: 'Claude',
        slug: 'claude',
        summary: 'Strong long-form reasoning and document analysis assistant.',
        description:
          'Anthropic-backed assistant optimized for nuanced reasoning, writing quality, and large-context conversations.',
        defaultModel: 'claude-3-5-sonnet-latest',
        status: ProviderStatus.ACTIVE,
        isFileUploadBeta: true,
      },
      {
        key: ProviderKey.GEMINI,
        name: 'Gemini',
        slug: 'gemini',
        summary: 'Fast multimodal assistant for search-heavy and product-style workflows.',
        description:
          'Google-backed assistant with strong multimodal tooling and practical speed for lightweight chat experiences.',
        defaultModel: 'gemini-3-flash-preview',
        status: ProviderStatus.ACTIVE,
        isFileUploadBeta: true,
      },
      {
        key: ProviderKey.NANO_BANANA,
        name: 'Nano Banana',
        slug: 'nano-banana',
        summary: 'Google image model for fast generation and visual editing workflows.',
        description:
          'Nano Banana uses Gemini image generation for prompt-based image creation and future image editing flows.',
        defaultModel: 'gemini-2.5-flash-image',
        status: ProviderStatus.ACTIVE,
        isFileUploadBeta: true,
      },
    ],
  });
}

async function bootstrapDev(app: ReturnType<typeof createApp>) {
  const response = await app.request('/api/auth/dev/bootstrap', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sharedSecret: env.DEV_AUTH_SHARED_SECRET,
    }),
  });

  assert.equal(response.status, 200);
  return (await response.json()) as BootstrapResponse;
}

async function requestWithAuth(
  app: ReturnType<typeof createApp>,
  token: string,
  path: string,
  init?: RequestInit,
) {
  return app.request(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`,
    },
  });
}

function mockGenerateResponse(
  providerKey: ProviderKey,
  implementation: () => Promise<ProviderGenerateResult>,
) {
  const registered = getRegisteredProvider(providerKey);
  const original = registered.adapter.generateResponse.bind(registered.adapter);
  registered.adapter.generateResponse = implementation;
  trackRestore(() => {
    registered.adapter.generateResponse = original;
  });
}

function mockExecuteAsyncJob(
  providerKey: ProviderKey,
  implementation: () => Promise<ProviderAsyncJobResult>,
) {
  const registered = getRegisteredProvider(providerKey);
  const original = registered.adapter.executeAsyncJob?.bind(registered.adapter);
  registered.adapter.executeAsyncJob = implementation;
  trackRestore(() => {
    registered.adapter.executeAsyncJob = original;
  });
}

async function waitForJobCompletion(
  app: ReturnType<typeof createApp>,
  token: string,
  jobId: string,
) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await requestWithAuth(app, token, `/api/jobs/${jobId}`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      job: {
        status: string;
        resultPayload: unknown;
        failureCode: string | null;
      };
    };

    if (body.job.status === 'COMPLETED' || body.job.status === 'FAILED') {
      return body.job;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Job ${jobId} did not complete in time`);
}

beforeEach(async () => {
  await clearDatabase();
  await seedProviders();
});

afterEach(async () => {
  while (restoreCallbacks.length > 0) {
    const restore = restoreCallbacks.pop();
    restore?.();
  }
  await clearDatabase();
});

after(async () => {
  await prisma.$disconnect();
});

test('dev bootstrap returns token user providers and default subscription', async () => {
  const app = createApp();
  const result = await bootstrapDev(app);

  assert.ok(result.token);
  assert.equal(result.user.telegramUserId, 'dev-user');
  assert.equal(result.providers.length, 4);
  assert.equal(result.subscription.status, 'INACTIVE');
  assert.equal(result.subscription.tokensRemaining, 0);
  assert.equal(result.subscription.hasAccess, false);
});

test('catalog providers endpoint exposes availability and capability metadata', async () => {
  const app = createApp();
  const bootstrap = await bootstrapDev(app);

  const response = await requestWithAuth(app, bootstrap.token, '/api/catalog/providers');
  const body = (await response.json()) as {
    providers: BootstrapResponse['providers'];
  };

  assert.equal(response.status, 200);
  assert.equal(body.providers.length, 4);
  assert.ok(body.providers.every((provider) => typeof provider.isAvailable === 'boolean'));
  assert.ok(body.providers.every((provider) => typeof provider.executionMode === 'string'));
  assert.ok(body.providers.every((provider) => typeof provider.capabilities.supportsText === 'boolean'));
  const nanoBanana = body.providers.find((provider) => provider.key === ProviderKey.NANO_BANANA);
  assert.ok(nanoBanana);
  assert.equal(nanoBanana.executionMode, 'async-job');
  assert.equal(nanoBanana.capabilities.supportsImage, true);
  assert.equal(nanoBanana.capabilities.supportsAsyncJobs, true);
});

test('subscription activation grants prepaid tokens and current user endpoint works', async () => {
  const app = createApp();
  const bootstrap = await bootstrapDev(app);

  const activateResponse = await requestWithAuth(app, bootstrap.token, '/api/subscription/dev/activate', {
    method: 'POST',
  });
  const activateBody = (await activateResponse.json()) as {
    subscription: BootstrapResponse['subscription'];
  };

  assert.equal(activateResponse.status, 200);
  assert.equal(activateBody.subscription.status, 'ACTIVE');
  assert.equal(activateBody.subscription.tokensAllowed, 1000);
  assert.equal(activateBody.subscription.tokensUsed, 0);
  assert.equal(activateBody.subscription.tokensRemaining, 1000);
  assert.equal(activateBody.subscription.hasAccess, true);

  const meResponse = await requestWithAuth(app, bootstrap.token, '/api/me');
  const meBody = (await meResponse.json()) as { user: BootstrapResponse['user'] };

  assert.equal(meResponse.status, 200);
  assert.equal(meBody.user.id, bootstrap.user.id);
});

test('chat flow creates a chat sends a message and decrements tokens', async () => {
  const app = createApp();
  const bootstrap = await bootstrapDev(app);
  const openAiProvider = bootstrap.providers.find((provider) => provider.key === ProviderKey.OPENAI);
  assert.ok(openAiProvider);

  const activateResponse = await requestWithAuth(app, bootstrap.token, '/api/subscription/dev/activate', {
    method: 'POST',
  });
  assert.equal(activateResponse.status, 200);

  mockGenerateResponse(ProviderKey.OPENAI, async () => ({
    text: 'Mocked OpenAI response',
    raw: {
      id: 'mock-openai-response',
    },
    usage: {
      inputTokens: 10,
      outputTokens: 6,
      totalTokens: 16,
      raw: {
        prompt_tokens: 10,
        completion_tokens: 6,
        total_tokens: 16,
      },
    },
    upstreamRequestId: 'req_mock_openai',
  }));

  const createChatResponse = await requestWithAuth(app, bootstrap.token, '/api/chats', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      providerId: openAiProvider.id,
    }),
  });
  const createChatBody = (await createChatResponse.json()) as {
    chat: {
      id: string;
      title: string;
      provider: {
        key: ProviderKey;
      };
    };
  };

  assert.equal(createChatResponse.status, 201);
  assert.equal(createChatBody.chat.provider.key, ProviderKey.OPENAI);

  const createMessageResponse = await requestWithAuth(
    app,
    bootstrap.token,
    `/api/chats/${createChatBody.chat.id}/messages`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        content: 'Hello, world',
      }),
    },
  );
  const createMessageBody = (await createMessageResponse.json()) as {
    userMessage: {
      role: string;
      content: string;
    };
    assistantMessage: {
      role: string;
      content: string;
      attachments: unknown[];
    };
    subscription: BootstrapResponse['subscription'];
  };

  assert.equal(createMessageResponse.status, 201);
  assert.equal(createMessageBody.userMessage.role, 'USER');
  assert.equal(createMessageBody.assistantMessage.role, 'ASSISTANT');
  assert.equal(createMessageBody.assistantMessage.content, 'Mocked OpenAI response');
  assert.deepEqual(createMessageBody.assistantMessage.attachments, []);
  assert.equal(createMessageBody.subscription.tokensRemaining, 999);

  const getChatResponse = await requestWithAuth(app, bootstrap.token, `/api/chats/${createChatBody.chat.id}/messages`);
  const getChatBody = (await getChatResponse.json()) as {
    chat: {
      messages: Array<{ role: string; content: string }>;
    };
  };

  assert.equal(getChatResponse.status, 200);
  assert.equal(getChatBody.chat.messages.length, 2);
});

test('jobs API creates runs and reports async provider jobs', async () => {
  const app = createApp();
  const bootstrap = await bootstrapDev(app);
  await requestWithAuth(app, bootstrap.token, '/api/subscription/dev/activate', {
    method: 'POST',
  });
  const openAiProvider = bootstrap.providers.find((provider) => provider.key === ProviderKey.OPENAI);
  assert.ok(openAiProvider);

  mockExecuteAsyncJob(ProviderKey.OPENAI, async () => ({
    resultPayload: {
      kind: GenerationJobKind.PROVIDER_ASYNC,
      text: 'Async provider result',
      raw: {
        id: 'mock-job-result',
      },
    },
    usage: {
      inputTokens: 4,
      outputTokens: 8,
      totalTokens: 12,
      raw: {
        prompt_tokens: 4,
        completion_tokens: 8,
        total_tokens: 12,
      },
    },
    upstreamRequestId: 'req_async_provider',
    externalJobId: 'gateway-job-1',
  }));

  const createJobResponse = await requestWithAuth(app, bootstrap.token, '/api/jobs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      providerId: openAiProvider.id,
      kind: GenerationJobKind.PROVIDER_ASYNC,
      prompt: 'Generate async response',
    }),
  });
  const createJobBody = (await createJobResponse.json()) as {
    job: {
      id: string;
      status: string;
    };
  };

  assert.equal(createJobResponse.status, 201);
  assert.ok(createJobBody.job.id);
  assert.match(createJobBody.job.status, /QUEUED|RUNNING|COMPLETED/);

  const completedJob = await waitForJobCompletion(app, bootstrap.token, createJobBody.job.id);

  assert.equal(completedJob.status, 'COMPLETED');
  assert.equal(completedJob.failureCode, null);
  assert.deepEqual(completedJob.resultPayload, {
    kind: GenerationJobKind.PROVIDER_ASYNC,
    text: 'Async provider result',
    raw: {
      id: 'mock-job-result',
    },
  });

  const jobsResponse = await requestWithAuth(app, bootstrap.token, '/api/jobs');
  const jobsBody = (await jobsResponse.json()) as {
    jobs: Array<{ id: string }>;
  };

  assert.equal(jobsResponse.status, 200);
  assert.ok(jobsBody.jobs.some((job) => job.id === createJobBody.job.id));
});

test('jobs API creates and completes Nano Banana image jobs', async () => {
  const app = createApp();
  const bootstrap = await bootstrapDev(app);
  await requestWithAuth(app, bootstrap.token, '/api/subscription/dev/activate', {
    method: 'POST',
  });
  const nanoBananaProvider = bootstrap.providers.find((provider) => provider.key === ProviderKey.NANO_BANANA);
  assert.ok(nanoBananaProvider);

  mockExecuteAsyncJob(ProviderKey.NANO_BANANA, async () => ({
    resultPayload: {
      kind: GenerationJobKind.IMAGE,
      text: 'Generated a neon banana.',
      images: [
        {
          index: 0,
          mimeType: 'image/png',
          filename: 'nano-banana-test.png',
          dataBase64: 'aW1hZ2U=',
          sizeBytes: 5,
        },
      ],
    },
    usage: {
      inputTokens: 6,
      outputTokens: 10,
      totalTokens: 16,
      raw: {
        promptTokenCount: 6,
        candidatesTokenCount: 10,
        totalTokenCount: 16,
      },
    },
    upstreamRequestId: 'req_nano_banana',
    externalJobId: null,
  }));

  const createJobResponse = await requestWithAuth(app, bootstrap.token, '/api/jobs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      providerId: nanoBananaProvider.id,
      kind: GenerationJobKind.IMAGE,
      prompt: 'Generate a cyberpunk banana mascot',
    }),
  });
  const createJobBody = (await createJobResponse.json()) as {
    job: {
      id: string;
      status: string;
    };
  };

  assert.equal(createJobResponse.status, 201);

  const completedJob = await waitForJobCompletion(app, bootstrap.token, createJobBody.job.id);
  assert.equal(completedJob.status, 'COMPLETED');
  assert.equal(completedJob.failureCode, null);
  assert.deepEqual(completedJob.resultPayload, {
    kind: GenerationJobKind.IMAGE,
    text: 'Generated a neon banana.',
    images: [
      {
        index: 0,
        mimeType: 'image/png',
        filename: 'nano-banana-test.png',
        dataBase64: 'aW1hZ2U=',
        sizeBytes: 5,
      },
    ],
  });
});
