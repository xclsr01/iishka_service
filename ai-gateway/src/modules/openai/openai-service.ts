import { env } from '../../env';
import { logger } from '../../lib/logger';
import { createEmptyResponseError } from '../gateway/provider-errors';
import { fetchProviderResponse } from '../gateway/provider-request';
import type { GatewayChatRespondRequest, GatewayChatRespondResponse, GatewayMessage } from '../gateway/gateway-types';

type OpenAiResponsesApiResponse = {
  id?: string;
  model?: string;
  status?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    [key: string]: unknown;
  };
};

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '');
}

function mapMessagesToResponsesInput(messages: GatewayMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: [
      {
        type: 'input_text',
        text: message.content,
      },
    ],
  }));
}

function extractText(data: OpenAiResponsesApiResponse) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  for (const outputItem of data.output ?? []) {
    for (const contentItem of outputItem.content ?? []) {
      if (typeof contentItem.text === 'string' && contentItem.text.trim()) {
        return contentItem.text.trim();
      }
    }
  }

  return null;
}

function buildRequestBody(input: GatewayChatRespondRequest, model: string) {
  return {
    model,
    input: mapMessagesToResponsesInput(input.messages),
    temperature: input.temperature,
    max_output_tokens: input.maxOutputTokens,
    metadata: input.metadata,
  };
}

export async function respondWithOpenAi(
  input: GatewayChatRespondRequest,
  routeRequestId: string,
): Promise<GatewayChatRespondResponse> {
  const provider = 'openai';
  const model = input.model || env.OPENAI_DEFAULT_MODEL;

  logger.info('provider_gateway_request_started', {
    route: '/v1/providers/openai/chat/respond',
    requestId: routeRequestId,
    provider,
    model,
    userId: input.userId ?? null,
    chatId: input.chatId ?? null,
    messageCount: input.messages.length,
  });

  const response = await fetchProviderResponse({
    provider,
    route: '/v1/providers/openai/chat/respond',
    requestId: routeRequestId,
    model,
    url: `${trimTrailingSlashes(env.OPENAI_BASE_URL)}/responses`,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(buildRequestBody(input, model)),
    },
    userId: input.userId,
    chatId: input.chatId,
  });

  const upstreamRequestId = response.headers.get('x-request-id') ?? response.headers.get('request-id');
  const data = (await response.json()) as OpenAiResponsesApiResponse;
  const text = extractText(data);

  if (!text) {
    throw createEmptyResponseError(provider);
  }

  return {
    provider,
    model: data.model ?? model,
    text,
    upstreamRequestId: upstreamRequestId ?? data.id ?? null,
    usage: data.usage
      ? {
          inputTokens: data.usage.input_tokens ?? null,
          outputTokens: data.usage.output_tokens ?? null,
          totalTokens: data.usage.total_tokens ?? null,
          raw: data.usage,
        }
      : null,
    raw: {
      id: data.id ?? null,
      model: data.model ?? model,
      responseStatus: data.status ?? null,
    },
  };
}
