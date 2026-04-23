import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderKey } from '@prisma/client';
import { env } from '../../env';
import { GeminiProviderAdapter } from './gemini-provider';
import { ProviderAdapterError } from './provider-types';

const originalFetch = globalThis.fetch;
const originalAiGatewayUrl = env.AI_GATEWAY_URL;
const originalAiGatewayToken = env.AI_GATEWAY_INTERNAL_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  env.AI_GATEWAY_URL = originalAiGatewayUrl;
  env.AI_GATEWAY_INTERNAL_TOKEN = originalAiGatewayToken;
});

test('GeminiProviderAdapter calls Google AI Studio generateContent with header auth', async () => {
  const adapter = new GeminiProviderAdapter();
  let calledUrl = '';
  let calledHeaders: Record<string, string> = {};
  let calledPayload: {
    contents: Array<{
      parts: Array<{ text: string }>;
    }>;
    tools: Array<{
      google_search: Record<string, never>;
    }>;
  } | null = null;

  env.AI_GATEWAY_URL = undefined;
  env.AI_GATEWAY_INTERNAL_TOKEN = undefined;

  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledHeaders = init?.headers as Record<string, string>;
    calledPayload = JSON.parse(String(init?.body));

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: 'AI finds patterns and predicts useful outputs.' }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 7,
          candidatesTokenCount: 9,
          totalTokenCount: 16,
        },
      }),
      {
        status: 200,
        headers: {
          'x-request-id': 'req_gemini_test',
        },
      },
    );
  };

  const result = await adapter.generateResponse({
    providerKey: ProviderKey.GEMINI,
    model: 'gemini-3-flash-preview',
    messages: [
      {
        role: 'user',
        content: 'Explain how AI works in a few words',
      },
    ],
  });

  assert.equal(
    calledUrl,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
  );
  assert.equal(calledHeaders['content-type'], 'application/json');
  assert.equal(calledHeaders['x-goog-api-key'], process.env.GOOGLE_AI_API_KEY);
  assert.ok(calledPayload);
  assert.equal(
    calledPayload.contents[0]?.parts[0]?.text,
    'USER: Explain how AI works in a few words',
  );
  assert.deepEqual(calledPayload.tools, [{ google_search: {} }]);
  assert.equal(result.text, 'AI finds patterns and predicts useful outputs.');
  assert.equal(result.upstreamRequestId, 'req_gemini_test');
  assert.deepEqual(result.usage, {
    inputTokens: 7,
    outputTokens: 9,
    totalTokens: 16,
    raw: {
      promptTokenCount: 7,
      candidatesTokenCount: 9,
      totalTokenCount: 16,
    },
  });
});

test('GeminiProviderAdapter calls configured AI gateway when available', async () => {
  const adapter = new GeminiProviderAdapter();
  let calledUrl = '';
  let calledHeaders: Record<string, string> = {};
  let calledPayload: {
    model: string;
    messages: Array<{ role: string; content: string }>;
  } | null = null;

  env.AI_GATEWAY_URL = 'https://ai-gateway.example.run.app';
  env.AI_GATEWAY_INTERNAL_TOKEN = 'test-ai-gateway-token-000000000000000000';

  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledHeaders = init?.headers as Record<string, string>;
    calledPayload = JSON.parse(String(init?.body));

    return new Response(
      JSON.stringify({
        provider: 'gemini',
        model: 'gemini-3-flash-preview',
        text: 'Gateway Gemini response',
        upstreamRequestId: 'req_gateway_gemini',
        usage: {
          inputTokens: 2,
          outputTokens: 3,
          totalTokens: 5,
          raw: {
            totalTokenCount: 5,
          },
        },
        raw: {
          usage: {
            totalTokenCount: 5,
          },
        },
      }),
      { status: 200 },
    );
  };

  const result = await adapter.generateResponse({
    providerKey: ProviderKey.GEMINI,
    model: 'gemini-3-flash-preview',
    messages: [
      {
        role: 'user',
        content: 'Hello',
      },
    ],
  });

  assert.equal(calledUrl, 'https://ai-gateway.example.run.app/v1/providers/gemini/chat/respond');
  assert.equal(calledHeaders.authorization, 'Bearer test-ai-gateway-token-000000000000000000');
  assert.ok(calledPayload);
  assert.equal(calledPayload.model, 'gemini-3-flash-preview');
  assert.deepEqual(calledPayload.messages, [{ role: 'user', content: 'Hello' }]);
  assert.equal(result.text, 'Gateway Gemini response');
  assert.equal(result.upstreamRequestId, 'req_gateway_gemini');
  assert.equal(result.raw.gateway, true);
  assert.equal(result.raw.gatewayProvider, 'gemini');
});

test('GeminiProviderAdapter classifies retryable Google AI rate limit errors', async () => {
  const adapter = new GeminiProviderAdapter();

  env.AI_GATEWAY_URL = undefined;
  env.AI_GATEWAY_INTERNAL_TOKEN = undefined;

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
      adapter.generateResponse({
        providerKey: ProviderKey.GEMINI,
        model: 'gemini-3-flash-preview',
        messages: [
          {
            role: 'user',
            content: 'Hello',
          },
        ],
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
