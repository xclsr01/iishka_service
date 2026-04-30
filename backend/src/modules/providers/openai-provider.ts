import { ProviderKey } from '@prisma/client';
import { AppError } from '../../lib/errors';
import { env } from '../../env';
import { getLogContext } from '../../lib/request-context';
import {
  assertDirectProviderEgressAllowed,
  generateGatewayChatResponse,
  isAiGatewayConfigured,
} from './gateway-client';
import type {
  AiProviderAdapter,
  ProviderAsyncJobInput,
  ProviderAsyncJobResult,
  ProviderAdapterError,
  ProviderCapabilitySet,
  ProviderGenerateInput,
  ProviderGenerateResult,
} from './provider-types';
import { ProviderAdapterError as NormalizedProviderError } from './provider-types';
import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  createProviderEmptyResponseError,
  createProviderNetworkError,
  createProviderRegionUnavailableError,
  createProviderTimeoutError,
  createUpstreamHttpError,
  isProviderTimeoutError,
} from './provider-error-mapping';

type OpenAiChatCompletionsResponse = {
  id: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    [key: string]: unknown;
  };
};

type OpenAiGatewayResponse = {
  text?: string;
  raw?: Record<string, unknown>;
  usage?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    requestUnits?: number | null;
    raw?: Record<string, unknown> | null;
  } | null;
  upstreamRequestId?: string | null;
};

type OpenAiGatewayErrorResponse = {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
};

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '');
}

export class OpenAiProviderAdapter implements AiProviderAdapter {
  readonly metadata = {
    key: ProviderKey.OPENAI,
    executionMode: 'interactive',
    capabilities: {
      supportsText: true,
      supportsImage: false,
      supportsStreaming: false,
      supportsAsyncJobs: true,
      supportsFiles: true,
    } satisfies ProviderCapabilitySet,
  } as const;

  classifyError(error: unknown): ProviderAdapterError {
    if (error instanceof NormalizedProviderError) {
      return error;
    }

    if (
      error instanceof AppError &&
      error.code === 'PROVIDER_REGION_UNAVAILABLE'
    ) {
      return createProviderRegionUnavailableError({
        key: ProviderKey.OPENAI,
        label: 'OpenAI',
        clientMessage: error.message,
      });
    }

    if (isProviderTimeoutError(error)) {
      return createProviderTimeoutError({
        key: ProviderKey.OPENAI,
        label: 'OpenAI',
      });
    }

    if (error instanceof AppError) {
      if (error.code === 'PROVIDER_EMPTY_RESPONSE') {
        return createProviderEmptyResponseError({
          key: ProviderKey.OPENAI,
          label: 'OpenAI',
        });
      }

      return new NormalizedProviderError({
        providerKey: ProviderKey.OPENAI,
        message: error.message,
        code: error.code,
        category: 'upstream',
        retryable: error.statusCode >= 500,
        statusCode: error.statusCode,
        details: error.details,
      });
    }

    if (error instanceof TypeError) {
      return createProviderNetworkError({
        key: ProviderKey.OPENAI,
        label: 'OpenAI',
        error,
      });
    }

    return new NormalizedProviderError({
      providerKey: ProviderKey.OPENAI,
      message: error instanceof Error ? error.message : 'OpenAI request failed',
      code: 'PROVIDER_REQUEST_FAILED',
      category: 'unknown',
      retryable: false,
      statusCode: 502,
    });
  }

  async generateResponse(
    input: ProviderGenerateInput,
  ): Promise<ProviderGenerateResult> {
    if (!env.OPENAI_ENABLED) {
      throw this.classifyError(
        new AppError(
          'ChatGPT is temporarily unavailable in this deployment region. Use Claude or Gemini, or route OpenAI through a separate proxy/server in a supported region.',
          503,
          'PROVIDER_REGION_UNAVAILABLE',
        ),
      );
    }

    if (isAiGatewayConfigured()) {
      return generateGatewayChatResponse(input);
    }

    assertDirectProviderEgressAllowed(ProviderKey.OPENAI, 'chat');

    if (env.OPENAI_GATEWAY_URL) {
      return this.generateResponseViaGateway(input);
    }

    return this.generateResponseDirect(input);
  }

  private createGatewayError(input: {
    status: number;
    code?: string;
    message?: string;
    upstreamRequestId?: string | null;
  }) {
    const code = input.code ?? 'PROVIDER_REQUEST_FAILED';

    if (code === 'PROVIDER_TIMEOUT') {
      return createProviderTimeoutError({
        key: ProviderKey.OPENAI,
        label: 'OpenAI gateway',
      });
    }

    if (code === 'PROVIDER_EMPTY_RESPONSE') {
      return createProviderEmptyResponseError({
        key: ProviderKey.OPENAI,
        label: 'OpenAI gateway',
      });
    }

    if (code === 'PROVIDER_RATE_LIMITED') {
      return new NormalizedProviderError({
        providerKey: ProviderKey.OPENAI,
        message: 'OpenAI gateway reported rate limiting',
        code,
        category: 'rate_limit',
        retryable: true,
        statusCode: 502,
        upstreamStatus: input.status,
        upstreamRequestId: input.upstreamRequestId ?? null,
      });
    }

    if (code === 'GATEWAY_UNAUTHORIZED') {
      return new NormalizedProviderError({
        providerKey: ProviderKey.OPENAI,
        message: 'OpenAI gateway authorization failed',
        code: 'PROVIDER_REQUEST_FAILED',
        category: 'auth',
        retryable: false,
        statusCode: 502,
        upstreamStatus: input.status,
        upstreamRequestId: input.upstreamRequestId ?? null,
      });
    }

    return new NormalizedProviderError({
      providerKey: ProviderKey.OPENAI,
      message: input.message || 'OpenAI gateway request failed',
      code: code.startsWith('PROVIDER_') ? code : 'PROVIDER_REQUEST_FAILED',
      category: input.status >= 500 ? 'service_unavailable' : 'bad_request',
      retryable:
        input.status === 408 || input.status === 429 || input.status >= 500,
      statusCode: 502,
      upstreamStatus: input.status,
      upstreamRequestId: input.upstreamRequestId ?? null,
    });
  }

  private async generateResponseViaGateway(
    input: ProviderGenerateInput,
  ): Promise<ProviderGenerateResult> {
    let response: Response;
    const requestId = getLogContext().requestId;

    try {
      response = await fetch(
        `${trimTrailingSlashes(env.OPENAI_GATEWAY_URL!)}/v1/chat/respond`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${env.OPENAI_GATEWAY_INTERNAL_TOKEN}`,
            ...(requestId ? { 'x-request-id': requestId } : {}),
          },
          body: JSON.stringify({
            model: input.model || env.OPENAI_MODEL,
            messages: input.messages,
            requestId,
          }),
          signal: AbortSignal.timeout(DEFAULT_PROVIDER_TIMEOUT_MS),
        },
      );
    } catch (error) {
      throw this.classifyError(error);
    }

    if (!response.ok) {
      const payload = (await response
        .json()
        .catch(() => null)) as OpenAiGatewayErrorResponse | null;
      throw this.classifyError(
        this.createGatewayError({
          status: response.status,
          code: payload?.error?.code,
          message: payload?.error?.message,
          upstreamRequestId:
            response.headers.get('x-request-id') ??
            response.headers.get('request-id') ??
            payload?.error?.requestId ??
            null,
        }),
      );
    }

    const data = (await response.json()) as OpenAiGatewayResponse;
    const text = data.text?.trim();
    if (!text) {
      throw this.classifyError(
        createProviderEmptyResponseError({
          key: ProviderKey.OPENAI,
          label: 'OpenAI gateway',
        }),
      );
    }

    return {
      text,
      raw: {
        gateway: true,
        ...(data.raw ?? {}),
      },
      usage: data.usage ?? null,
      upstreamRequestId:
        response.headers.get('x-request-id') ??
        response.headers.get('request-id') ??
        data.upstreamRequestId ??
        null,
    };
  }

  private async generateResponseDirect(
    input: ProviderGenerateInput,
  ): Promise<ProviderGenerateResult> {
    let response: Response;
    try {
      response = await fetch(`${env.OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: input.model || env.OPENAI_MODEL,
          messages: input.messages,
        }),
        signal: AbortSignal.timeout(DEFAULT_PROVIDER_TIMEOUT_MS),
      });
    } catch (error) {
      throw this.classifyError(error);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const upstreamRequestId =
        response.headers.get('x-request-id') ??
        response.headers.get('request-id');

      if (body.includes('unsupported_country_region_territory')) {
        throw this.classifyError(
          createProviderRegionUnavailableError({
            key: ProviderKey.OPENAI,
            label: 'OpenAI',
            clientMessage:
              'ChatGPT is temporarily unavailable in this deployment region. Use Claude or Gemini, or route OpenAI through a separate proxy/server in a supported region.',
            upstreamRequestId,
          }),
        );
      }

      throw this.classifyError(
        createUpstreamHttpError({
          key: ProviderKey.OPENAI,
          label: 'OpenAI',
          status: response.status,
          upstreamRequestId,
          rawBody: body,
        }),
      );
    }

    const data = (await response.json()) as OpenAiChatCompletionsResponse;

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw this.classifyError(
        createProviderEmptyResponseError({
          key: ProviderKey.OPENAI,
          label: 'OpenAI',
        }),
      );
    }

    return {
      text,
      raw: {
        id: data.id,
        usage: data.usage ?? null,
      },
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens ?? null,
            outputTokens: data.usage.completion_tokens ?? null,
            totalTokens: data.usage.total_tokens ?? null,
            raw: data.usage,
          }
        : null,
      upstreamRequestId:
        response.headers.get('x-request-id') ??
        response.headers.get('request-id') ??
        data.id ??
        null,
    };
  }

  async executeAsyncJob(
    input: ProviderAsyncJobInput,
  ): Promise<ProviderAsyncJobResult> {
    if (input.kind !== 'PROVIDER_ASYNC') {
      throw new AppError(
        'OpenAI async job kind is not supported',
        400,
        'PROVIDER_JOB_KIND_UNSUPPORTED',
      );
    }

    const result = await this.generateResponse({
      providerKey: input.providerKey,
      model: input.model,
      chatId: input.chatId,
      userId: input.userId,
      messages: [
        {
          role: 'user',
          content: input.prompt,
        },
      ],
    });

    return {
      resultPayload: {
        kind: input.kind,
        text: result.text,
        raw: result.raw,
      },
      usage: result.usage,
      upstreamRequestId: result.upstreamRequestId,
      externalJobId: null,
    };
  }
}
