import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GenerationJobKind, ProviderKey } from '@prisma/client';
import { env } from '../../env';
import { NanoBananaProviderAdapter } from './nano-banana-provider';
import { ProviderAdapterError } from './provider-types';

const originalFetch = globalThis.fetch;
const originalAiGatewayUrl = env.AI_GATEWAY_URL;
const originalAiGatewayToken = env.AI_GATEWAY_INTERNAL_TOKEN;
const originalAllowDirectProviderEgress = env.ALLOW_DIRECT_PROVIDER_EGRESS;

afterEach(() => {
  globalThis.fetch = originalFetch;
  env.AI_GATEWAY_URL = originalAiGatewayUrl;
  env.AI_GATEWAY_INTERNAL_TOKEN = originalAiGatewayToken;
  env.ALLOW_DIRECT_PROVIDER_EGRESS = originalAllowDirectProviderEgress;
});

test('NanoBananaProviderAdapter generates image jobs with Google AI Studio header auth', async () => {
  const adapter = new NanoBananaProviderAdapter();
  let calledUrl = '';
  let calledHeaders: Record<string, string> = {};
  let calledPayload: {
    contents: Array<{
      role: string;
      parts: Array<{ text: string }>;
    }>;
    generationConfig: {
      responseModalities: string[];
    };
  } | null = null;

  env.AI_GATEWAY_URL = undefined;
  env.AI_GATEWAY_INTERNAL_TOKEN = undefined;
  env.ALLOW_DIRECT_PROVIDER_EGRESS = true;

  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledHeaders = init?.headers as Record<string, string>;
    calledPayload = JSON.parse(String(init?.body));

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { text: 'Here is your generated image.' },
                {
                  inlineData: {
                    mimeType: 'image/png',
                    data: 'aW1hZ2U=',
                  },
                },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 8,
          totalTokenCount: 13,
        },
      }),
      {
        status: 200,
        headers: {
          'x-request-id': 'req_nano_test',
        },
      },
    );
  };

  const result = await adapter.executeAsyncJob({
    providerKey: ProviderKey.NANO_BANANA,
    jobId: 'job_test',
    kind: GenerationJobKind.IMAGE,
    model: 'gemini-2.5-flash-image',
    prompt: 'Generate a neon banana mascot',
  });

  assert.equal(
    calledUrl,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
  );
  assert.equal(calledHeaders['content-type'], 'application/json');
  assert.equal(calledHeaders['x-goog-api-key'], process.env.GOOGLE_AI_API_KEY);
  assert.ok(calledPayload);
  assert.deepEqual(calledPayload.generationConfig.responseModalities, [
    'IMAGE',
    'TEXT',
  ]);
  assert.equal(calledPayload.contents[0]?.role, 'user');
  assert.equal(
    calledPayload.contents[0]?.parts[0]?.text,
    'Generate a neon banana mascot',
  );
  assert.equal(result.upstreamRequestId, 'req_nano_test');
  assert.deepEqual(result.resultPayload, {
    kind: GenerationJobKind.IMAGE,
    text: 'Here is your generated image.',
    images: [
      {
        index: 0,
        mimeType: 'image/png',
        filename: 'nano-banana-job_test-0.png',
        dataBase64: 'aW1hZ2U=',
        sizeBytes: 5,
      },
    ],
  });
  assert.deepEqual(result.usage, {
    inputTokens: 5,
    outputTokens: 8,
    totalTokens: 13,
    raw: {
      promptTokenCount: 5,
      candidatesTokenCount: 8,
      totalTokenCount: 13,
    },
  });
});

test('NanoBananaProviderAdapter executes image jobs through configured AI gateway', async () => {
  const adapter = new NanoBananaProviderAdapter();
  let calledUrl = '';
  let calledHeaders: Record<string, string> = {};
  let calledPayload: {
    kind: string;
    model: string;
    prompt: string;
    jobId: string;
  } | null = null;

  env.AI_GATEWAY_URL = 'https://ai-gateway.example.run.app';
  env.AI_GATEWAY_INTERNAL_TOKEN = 'test-ai-gateway-token-000000000000000000';

  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledHeaders = init?.headers as Record<string, string>;
    calledPayload = JSON.parse(String(init?.body));

    return new Response(
      JSON.stringify({
        provider: 'nano-banana',
        model: 'gemini-2.5-flash-image',
        resultPayload: {
          kind: GenerationJobKind.IMAGE,
          text: 'Generated through gateway.',
          images: [
            {
              index: 0,
              mimeType: 'image/png',
              filename: 'nano-banana-job_test-0.png',
              dataBase64: 'aW1hZ2U=',
              sizeBytes: 5,
            },
          ],
        },
        upstreamRequestId: 'req_gateway_nano',
        externalJobId: null,
        usage: {
          inputTokens: 5,
          outputTokens: 8,
          totalTokens: 13,
          raw: {
            totalTokenCount: 13,
          },
        },
      }),
      { status: 200 },
    );
  };

  const result = await adapter.executeAsyncJob({
    providerKey: ProviderKey.NANO_BANANA,
    jobId: 'job_test',
    kind: GenerationJobKind.IMAGE,
    model: 'gemini-2.5-flash-image',
    prompt: 'Generate a neon banana mascot',
  });

  assert.equal(
    calledUrl,
    'https://ai-gateway.example.run.app/v1/providers/nano-banana/jobs/execute',
  );
  assert.equal(
    calledHeaders.authorization,
    'Bearer test-ai-gateway-token-000000000000000000',
  );
  assert.ok(calledPayload);
  assert.equal(calledPayload.kind, GenerationJobKind.IMAGE);
  assert.equal(calledPayload.model, 'gemini-2.5-flash-image');
  assert.equal(calledPayload.prompt, 'Generate a neon banana mascot');
  assert.equal(calledPayload.jobId, 'job_test');
  assert.equal(result.upstreamRequestId, 'req_gateway_nano');
  assert.deepEqual(result.resultPayload, {
    kind: GenerationJobKind.IMAGE,
    text: 'Generated through gateway.',
    images: [
      {
        index: 0,
        mimeType: 'image/png',
        filename: 'nano-banana-job_test-0.png',
        dataBase64: 'aW1hZ2U=',
        sizeBytes: 5,
      },
    ],
  });
});

test('NanoBananaProviderAdapter rejects non-image job kinds', async () => {
  const adapter = new NanoBananaProviderAdapter();

  env.AI_GATEWAY_URL = undefined;
  env.AI_GATEWAY_INTERNAL_TOKEN = undefined;
  env.ALLOW_DIRECT_PROVIDER_EGRESS = true;

  await assert.rejects(
    () =>
      adapter.executeAsyncJob({
        providerKey: ProviderKey.NANO_BANANA,
        jobId: 'job_test',
        kind: GenerationJobKind.PROVIDER_ASYNC,
        model: 'gemini-2.5-flash-image',
        prompt: 'Hello',
      }),
    /only supports image generation jobs/,
  );
});

test('NanoBananaProviderAdapter classifies retryable rate limit errors', async () => {
  const adapter = new NanoBananaProviderAdapter();

  env.AI_GATEWAY_URL = undefined;
  env.AI_GATEWAY_INTERNAL_TOKEN = undefined;
  env.ALLOW_DIRECT_PROVIDER_EGRESS = true;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: 429,
          message: 'Quota exceeded',
          status: 'RESOURCE_EXHAUSTED',
        },
      }),
      { status: 429 },
    );

  await assert.rejects(
    () =>
      adapter.executeAsyncJob({
        providerKey: ProviderKey.NANO_BANANA,
        jobId: 'job_test',
        kind: GenerationJobKind.IMAGE,
        model: 'gemini-2.5-flash-image',
        prompt: 'Hello',
      }),
    (error) => {
      assert.ok(error instanceof ProviderAdapterError);
      assert.equal(error.code, 'PROVIDER_RATE_LIMITED');
      assert.equal(error.category, 'rate_limit');
      assert.equal(error.retryable, true);
      assert.equal(error.upstreamStatus, 429);
      return true;
    },
  );
});
