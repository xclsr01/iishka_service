import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderKey } from '@prisma/client';
import { env } from '../../env';
import { GeminiProviderAdapter } from './gemini-provider';
import { ProviderAdapterError } from './provider-types';

const originalFetch = globalThis.fetch;
const originalAiGatewayUrl = env.AI_GATEWAY_URL;
const originalAiGatewayToken = env.AI_GATEWAY_INTERNAL_TOKEN;
const originalGoogleAiModel = env.GOOGLE_AI_MODEL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  env.AI_GATEWAY_URL = originalAiGatewayUrl;
  env.AI_GATEWAY_INTERNAL_TOKEN = originalAiGatewayToken;
  env.GOOGLE_AI_MODEL = originalGoogleAiModel;
});

test('GeminiProviderAdapter calls Google AI Studio generateContent with header auth', async () => {
  const adapter = new GeminiProviderAdapter();
  let calledUrl = '';
  let calledHeaders: Record<string, string> = {};
  let calledPayload: {
    contents: Array<{
      role?: string;
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
    model: 'gemini-2.5-flash',
    messages: [
      {
        role: 'user',
        content: 'Explain how AI works in a few words',
      },
    ],
  });

  assert.equal(
    calledUrl,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  );
  assert.equal(calledHeaders['content-type'], 'application/json');
  assert.equal(calledHeaders['x-goog-api-key'], process.env.GOOGLE_AI_API_KEY);
  assert.ok(calledPayload);
  assert.equal(calledPayload.contents[0]?.role, 'user');
  assert.match(calledPayload.contents[0]?.parts[0]?.text ?? '', /Google Search grounding is enabled/);
  assert.match(calledPayload.contents[0]?.parts[0]?.text ?? '', /USER: Explain how AI works in a few words/);
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

test('GeminiProviderAdapter retries without search grounding when Gemini rejects the grounded request', async () => {
  const adapter = new GeminiProviderAdapter();
  const calledPayloads: Array<{
    tools?: Array<{
      google_search: Record<string, never>;
    }>;
  }> = [];

  env.AI_GATEWAY_URL = undefined;
  env.AI_GATEWAY_INTERNAL_TOKEN = undefined;

  globalThis.fetch = async (_input, init) => {
    calledPayloads.push(JSON.parse(String(init?.body)));

    if (calledPayloads.length === 1) {
      return new Response(
        JSON.stringify({
          error: {
            code: 400,
            message: 'Search grounding is not supported for this request.',
            status: 'INVALID_ARGUMENT',
          },
        }),
        { status: 400 },
      );
    }

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: 'Fallback Gemini response' }],
            },
          },
        ],
      }),
      { status: 200 },
    );
  };

  const result = await adapter.generateResponse({
    providerKey: ProviderKey.GEMINI,
    model: 'gemini-2.5-flash',
    messages: [
      {
        role: 'user',
        content: 'Hello',
      },
    ],
  });

  assert.equal(calledPayloads.length, 2);
  assert.deepEqual(calledPayloads[0]?.tools, [{ google_search: {} }]);
  assert.equal(calledPayloads[1]?.tools, undefined);
  assert.equal(result.text, 'Fallback Gemini response');
});

test('GeminiProviderAdapter normalizes model names and falls back to default on model 404', async () => {
  const adapter = new GeminiProviderAdapter();
  const calledUrls: string[] = [];

  env.AI_GATEWAY_URL = undefined;
  env.AI_GATEWAY_INTERNAL_TOKEN = undefined;
  env.GOOGLE_AI_MODEL = 'gemini-2.5-flash';

  globalThis.fetch = async (input) => {
    calledUrls.push(String(input));

    if (calledUrls.length === 1) {
      return new Response(
        JSON.stringify({
          error: {
            code: 404,
            message: 'Model not found',
            status: 'NOT_FOUND',
          },
        }),
        { status: 404 },
      );
    }

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: 'Fallback model response' }],
            },
          },
        ],
      }),
      { status: 200 },
    );
  };

  const result = await adapter.generateResponse({
    providerKey: ProviderKey.GEMINI,
    model: 'models/gemini-retired-chat-model',
    messages: [
      {
        role: 'user',
        content: 'Hello',
      },
    ],
  });

  assert.deepEqual(calledUrls, [
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-retired-chat-model:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  ]);
  assert.equal(result.text, 'Fallback model response');
});

test('GeminiProviderAdapter falls back to stable chat model when configured model is unavailable', async () => {
  const adapter = new GeminiProviderAdapter();
  const calledUrls: string[] = [];

  env.AI_GATEWAY_URL = undefined;
  env.AI_GATEWAY_INTERNAL_TOKEN = undefined;
  env.GOOGLE_AI_MODEL = 'gemini-3.0-flash';

  globalThis.fetch = async (input) => {
    calledUrls.push(String(input));

    if (calledUrls.length === 1) {
      return new Response(
        JSON.stringify({
          error: {
            code: 404,
            message: 'Model not found',
            status: 'NOT_FOUND',
          },
        }),
        { status: 404 },
      );
    }

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: 'Stable fallback response' }],
            },
          },
        ],
      }),
      { status: 200 },
    );
  };

  const result = await adapter.generateResponse({
    providerKey: ProviderKey.GEMINI,
    model: 'gemini-3.0-flash',
    messages: [
      {
        role: 'user',
        content: 'Hello',
      },
    ],
  });

  assert.deepEqual(calledUrls, [
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.0-flash:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  ]);
  assert.equal(result.text, 'Stable fallback response');
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
        model: 'gemini-2.5-flash',
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
    model: 'gemini-2.5-flash',
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
  assert.equal(calledPayload.model, 'gemini-2.5-flash');
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
        model: 'gemini-2.5-flash',
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
