import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderKey } from '@prisma/client';
import { GeminiProviderAdapter } from './gemini-provider';
import { ProviderAdapterError } from './provider-types';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('GeminiProviderAdapter calls Google AI Studio generateContent with header auth', async () => {
  const adapter = new GeminiProviderAdapter();
  let calledUrl = '';
  let calledHeaders: Record<string, string> = {};
  let calledPayload: {
    contents: Array<{
      parts: Array<{ text: string }>;
    }>;
  } | null = null;

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
    model: 'gemini-flash-latest',
    messages: [
      {
        role: 'user',
        content: 'Explain how AI works in a few words',
      },
    ],
  });

  assert.equal(
    calledUrl,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
  );
  assert.equal(calledHeaders['content-type'], 'application/json');
  assert.equal(calledHeaders['x-goog-api-key'], process.env.GOOGLE_AI_API_KEY);
  assert.ok(calledPayload);
  assert.equal(
    calledPayload.contents[0]?.parts[0]?.text,
    'USER: Explain how AI works in a few words',
  );
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

test('GeminiProviderAdapter classifies retryable Google AI rate limit errors', async () => {
  const adapter = new GeminiProviderAdapter();

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
        model: 'gemini-flash-latest',
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
