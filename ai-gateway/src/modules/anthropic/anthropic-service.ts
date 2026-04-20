import { env } from '../../env';
import { logger } from '../../lib/logger';
import { createEmptyResponseError } from '../gateway/provider-errors';
import { fetchProviderResponse } from '../gateway/provider-request';
import type { GatewayChatRespondRequest, GatewayChatRespondResponse } from '../gateway/gateway-types';

type AnthropicMessagesResponse = {
  id?: string;
  model?: string;
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    [key: string]: unknown;
  };
};

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '');
}

function buildRequestBody(input: GatewayChatRespondRequest, model: string) {
  const system = input.messages.find((message) => message.role === 'system')?.content;
  const messages = input.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

  return {
    model,
    max_tokens: input.maxOutputTokens ?? 1024,
    temperature: input.temperature,
    system,
    messages,
    metadata: input.userId ? { user_id: input.userId } : undefined,
  };
}

export async function respondWithAnthropic(
  input: GatewayChatRespondRequest,
  routeRequestId: string,
): Promise<GatewayChatRespondResponse> {
  const provider = 'anthropic';
  const model = input.model || env.ANTHROPIC_DEFAULT_MODEL;

  logger.info('provider_gateway_request_started', {
    route: '/v1/providers/anthropic/chat/respond',
    requestId: routeRequestId,
    provider,
    model,
    userId: input.userId ?? null,
    chatId: input.chatId ?? null,
    messageCount: input.messages.length,
  });

  const response = await fetchProviderResponse({
    provider,
    route: '/v1/providers/anthropic/chat/respond',
    requestId: routeRequestId,
    model,
    url: `${trimTrailingSlashes(env.ANTHROPIC_BASE_URL)}/v1/messages`,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': env.ANTHROPIC_VERSION,
      },
      body: JSON.stringify(buildRequestBody(input, model)),
    },
    userId: input.userId,
    chatId: input.chatId,
  });

  const upstreamRequestId = response.headers.get('request-id') ?? response.headers.get('x-request-id');
  const data = (await response.json()) as AnthropicMessagesResponse;
  const text = data.content?.find((item) => item.type === 'text')?.text?.trim();

  if (!text) {
    throw createEmptyResponseError(provider);
  }

  const totalTokens =
    typeof data.usage?.input_tokens === 'number' || typeof data.usage?.output_tokens === 'number'
      ? (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0)
      : null;

  return {
    provider,
    model: data.model ?? model,
    text,
    upstreamRequestId: upstreamRequestId ?? data.id ?? null,
    usage: data.usage
      ? {
          inputTokens: data.usage.input_tokens ?? null,
          outputTokens: data.usage.output_tokens ?? null,
          totalTokens,
          raw: data.usage,
        }
      : null,
    raw: {
      id: data.id ?? null,
      model: data.model ?? model,
    },
  };
}
