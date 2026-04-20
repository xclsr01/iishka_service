import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderKey } from '@prisma/client';
import { env } from '../../env';
import { AnthropicProviderAdapter } from './anthropic-provider';

const originalFetch = globalThis.fetch;
const originalAiGatewayUrl = env.AI_GATEWAY_URL;
const originalAiGatewayToken = env.AI_GATEWAY_INTERNAL_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  env.AI_GATEWAY_URL = originalAiGatewayUrl;
  env.AI_GATEWAY_INTERNAL_TOKEN = originalAiGatewayToken;
});

test('AnthropicProviderAdapter calls configured AI gateway when available', async () => {
  const adapter = new AnthropicProviderAdapter();
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
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-latest',
        text: 'Gateway Claude response',
        upstreamRequestId: 'req_gateway_anthropic',
        usage: {
          inputTokens: 4,
          outputTokens: 6,
          totalTokens: 10,
          raw: {
            input_tokens: 4,
            output_tokens: 6,
          },
        },
        raw: {
          id: 'msg_gateway',
        },
      }),
      { status: 200 },
    );
  };

  const result = await adapter.generateResponse({
    providerKey: ProviderKey.ANTHROPIC,
    model: 'claude-3-5-sonnet-latest',
    messages: [
      {
        role: 'user',
        content: 'Hello',
      },
    ],
  });

  assert.equal(calledUrl, 'https://ai-gateway.example.run.app/v1/providers/anthropic/chat/respond');
  assert.equal(calledHeaders.authorization, 'Bearer test-ai-gateway-token-000000000000000000');
  assert.ok(calledPayload);
  assert.equal(calledPayload.model, 'claude-3-5-sonnet-latest');
  assert.deepEqual(calledPayload.messages, [{ role: 'user', content: 'Hello' }]);
  assert.equal(result.text, 'Gateway Claude response');
  assert.equal(result.upstreamRequestId, 'req_gateway_anthropic');
  assert.equal(result.raw.gateway, true);
  assert.equal(result.raw.gatewayProvider, 'anthropic');
});
