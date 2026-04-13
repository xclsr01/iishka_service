import { env } from '../../env';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { retryAsync } from '../../lib/retry';
import {
  createEmptyResponseError,
  createNetworkError,
  createTimeoutError,
  createUpstreamHttpError,
  isRetryableGatewayError,
} from './openai-error-mapping';
import type {
  GatewayChatMessage,
  GatewayChatRespondRequest,
  GatewayChatRespondResponse,
} from './openai-types';

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

function mapMessagesToResponsesInput(messages: GatewayChatMessage[]) {
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
      if (contentItem.type === 'output_text' && typeof contentItem.text === 'string' && contentItem.text.trim()) {
        return contentItem.text.trim();
      }

      if (typeof contentItem.text === 'string' && contentItem.text.trim()) {
        return contentItem.text.trim();
      }
    }
  }

  return null;
}

function buildRequestBody(input: GatewayChatRespondRequest) {
  return {
    model: input.model || env.OPENAI_DEFAULT_MODEL,
    input: mapMessagesToResponsesInput(input.messages),
    temperature: input.temperature,
    max_output_tokens: input.maxOutputTokens,
    metadata: input.metadata,
  };
}

async function fetchOpenAiResponse(
  input: GatewayChatRespondRequest,
  routeRequestId: string,
  attemptNumber: number,
) {
  const responseStartedAt = Date.now();
  let response: Response;

  try {
    response = await fetch(`${env.OPENAI_BASE_URL}/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(buildRequestBody(input)),
      signal: AbortSignal.timeout(env.OPENAI_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw createTimeoutError();
    }

    if (error instanceof TypeError) {
      throw createNetworkError(error);
    }

    throw error;
  }

  const upstreamRequestId = response.headers.get('x-request-id') ?? response.headers.get('request-id');
  const latencyMs = Date.now() - responseStartedAt;

  if (!response.ok) {
    const rawBody = await response.text().catch(() => '');
    throw createUpstreamHttpError({
      status: response.status,
      upstreamRequestId,
      rawBody,
    });
  }

  const data = (await response.json()) as OpenAiResponsesApiResponse;
  const text = extractText(data);

  if (!text) {
    throw createEmptyResponseError();
  }

  logger.info('openai_upstream_completed', {
    route: '/v1/chat/respond',
    requestId: routeRequestId,
    provider: 'openai',
    model: input.model,
    userId: input.userId ?? null,
    chatId: input.chatId ?? null,
    retryCount: attemptNumber,
    upstreamStatus: response.status,
    upstreamRequestId,
    latencyMs,
  });

  return {
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
      model: data.model ?? input.model,
      responseStatus: data.status ?? null,
    },
  } satisfies GatewayChatRespondResponse;
}

export async function respondWithOpenAi(
  input: GatewayChatRespondRequest,
  routeRequestId: string,
): Promise<GatewayChatRespondResponse> {
  logger.info('openai_gateway_request_started', {
    route: '/v1/chat/respond',
    requestId: routeRequestId,
    provider: 'openai',
    model: input.model,
    userId: input.userId ?? null,
    chatId: input.chatId ?? null,
    messageCount: input.messages.length,
  });

  try {
    return await retryAsync(
      async ({ attemptNumber }) => {
        return fetchOpenAiResponse(input, routeRequestId, attemptNumber);
      },
      {
        maxRetries: env.OPENAI_MAX_RETRIES,
        baseDelayMs: env.OPENAI_RETRY_BASE_DELAY_MS,
        shouldRetry: (error) => isRetryableGatewayError(error),
        onRetry: (error, context) => {
          const appError =
            error instanceof AppError
              ? error
              : new AppError({
                  message: error instanceof Error ? error.message : 'OpenAI request failed',
                });
          logger.info('openai_gateway_retry_scheduled', {
            route: '/v1/chat/respond',
            requestId: routeRequestId,
            provider: 'openai',
            model: input.model,
            userId: input.userId ?? null,
            chatId: input.chatId ?? null,
            retryCount: context.attemptNumber + 1,
            nextDelayMs: context.nextDelayMs,
            errorCode: appError.code,
            upstreamStatus: appError.upstreamStatus ?? null,
            upstreamRequestId: appError.upstreamRequestId ?? null,
          });
        },
      },
    );
  } catch (error) {
    const appError =
      error instanceof AppError
        ? error
        : new AppError({
            message: error instanceof Error ? error.message : 'OpenAI request failed',
            statusCode: 500,
            code: 'INTERNAL_ERROR',
          });

    logger.error('openai_gateway_request_failed', {
      route: '/v1/chat/respond',
      requestId: routeRequestId,
      provider: 'openai',
      model: input.model,
      userId: input.userId ?? null,
      chatId: input.chatId ?? null,
      errorCode: appError.code,
      retryable: appError.retryable ?? null,
      upstreamStatus: appError.upstreamStatus ?? null,
      upstreamRequestId: appError.upstreamRequestId ?? null,
      details: appError.details ?? null,
      message: appError.message,
    });

    throw appError;
  }
}
