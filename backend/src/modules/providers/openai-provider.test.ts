import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderKey } from '@prisma/client';
import { env } from '../../env';
import { runWithLogContext } from '../../lib/request-context';
import { OpenAiProviderAdapter } from './openai-provider';

const originalFetch = globalThis.fetch;
const originalAiGatewayUrl = env.AI_GATEWAY_URL;
const originalAiGatewayToken = env.AI_GATEWAY_INTERNAL_TOKEN;
const originalGatewayUrl = env.OPENAI_GATEWAY_URL;
const originalGatewayToken = env.OPENAI_GATEWAY_INTERNAL_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  env.AI_GATEWAY_URL = originalAiGatewayUrl;
  env.AI_GATEWAY_INTERNAL_TOKEN = originalAiGatewayToken;
  env.OPENAI_GATEWAY_URL = originalGatewayUrl;
  env.OPENAI_GATEWAY_INTERNAL_TOKEN = originalGatewayToken;
});

test('OpenAiProviderAdapter calls configured internal gateway instead of direct OpenAI API', async () => {
  const adapter = new OpenAiProviderAdapter();
  let calledUrl = '';
  let calledHeaders: Record<string, string> = {};
  let calledPayload: {
    model: string;
    requestId?: string;
    messages: Array<{ role: string; content: string }>;
  } | null = null;

  env.AI_GATEWAY_URL = 'https://ai-gateway.example.run.app';
  env.AI_GATEWAY_INTERNAL_TOKEN = 'test-ai-gateway-token-000000000000000000';
  env.OPENAI_GATEWAY_URL = undefined;
  env.OPENAI_GATEWAY_INTERNAL_TOKEN = undefined;

  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledHeaders = init?.headers as Record<string, string>;
    calledPayload = JSON.parse(String(init?.body));

    return new Response(
      JSON.stringify({
        text: 'Gateway response',
        upstreamRequestId: 'req_gateway_openai',
        usage: {
          inputTokens: 3,
          outputTokens: 4,
          totalTokens: 7,
          raw: {
            input_tokens: 3,
            output_tokens: 4,
            total_tokens: 7,
          },
        },
        provider: 'openai',
        model: 'gpt-5.4-mini',
        raw: {
          id: 'resp_gateway',
          model: 'gpt-5.4-mini',
          responseStatus: 'completed',
        },
      }),
      {
        status: 200,
      },
    );
  };

  const result = await runWithLogContext({ requestId: 'req_local_test' }, () =>
    adapter.generateResponse({
      providerKey: ProviderKey.OPENAI,
      model: 'gpt-5.4-mini',
      messages: [
        {
          role: 'user',
          content: 'Hello',
        },
      ],
    }),
  );

  assert.equal(calledUrl, 'https://ai-gateway.example.run.app/v1/providers/openai/chat/respond');
  assert.equal(calledHeaders.authorization, 'Bearer test-ai-gateway-token-000000000000000000');
  assert.equal(calledHeaders['content-type'], 'application/json');
  assert.equal(calledHeaders['x-request-id'], 'req_local_test');
  assert.ok(calledPayload);
  assert.equal(calledPayload.requestId, 'req_local_test');
  assert.deepEqual(calledPayload.messages, [{ role: 'user', content: 'Hello' }]);
  assert.equal(calledPayload.model, 'gpt-5.4-mini');
  assert.equal(result.text, 'Gateway response');
  assert.equal(result.upstreamRequestId, 'req_gateway_openai');
  assert.deepEqual(result.usage, {
    inputTokens: 3,
    outputTokens: 4,
    totalTokens: 7,
    raw: {
      input_tokens: 3,
      output_tokens: 4,
      total_tokens: 7,
    },
  });
  assert.equal(result.raw.gateway, true);
  assert.equal(result.raw.gatewayProvider, 'openai');
  assert.equal(result.raw.gatewayModel, 'gpt-5.4-mini');
  assert.equal(result.raw.id, 'resp_gateway');
});
