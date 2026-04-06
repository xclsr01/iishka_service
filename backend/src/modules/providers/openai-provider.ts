import { ProviderKey } from '@prisma/client';
import { AppError } from '../../lib/errors';
import { env } from '../../env';
import type {
  AiProviderAdapter,
  ProviderAdapterError,
  ProviderCapabilitySet,
  ProviderGenerateInput,
  ProviderGenerateResult,
} from './provider-types';
import { ProviderAdapterError as NormalizedProviderError } from './provider-types';

export class OpenAiProviderAdapter implements AiProviderAdapter {
  readonly metadata = {
    key: ProviderKey.OPENAI,
    executionMode: 'interactive',
    capabilities: {
      supportsText: true,
      supportsImage: false,
      supportsStreaming: false,
      supportsAsyncJobs: false,
      supportsFiles: true,
    } satisfies ProviderCapabilitySet,
  } as const;

  classifyError(error: unknown): ProviderAdapterError {
    if (error instanceof NormalizedProviderError) {
      return error;
    }

    if (error instanceof AppError && error.code === 'PROVIDER_REGION_UNAVAILABLE') {
      return new NormalizedProviderError({
        providerKey: ProviderKey.OPENAI,
        message: error.message,
        code: error.code,
        category: 'region_unavailable',
        retryable: false,
        statusCode: error.statusCode,
        details: error.details,
      });
    }

    if (error instanceof Error && error.name === 'TimeoutError') {
      return new NormalizedProviderError({
        providerKey: ProviderKey.OPENAI,
        message: 'OpenAI request timed out',
        code: 'PROVIDER_TIMEOUT',
        category: 'timeout',
        retryable: true,
        statusCode: 504,
      });
    }

    if (error instanceof AppError) {
      return new NormalizedProviderError({
        providerKey: ProviderKey.OPENAI,
        message: error.message,
        code: error.code,
        category: error.code === 'PROVIDER_EMPTY_RESPONSE' ? 'empty_response' : 'upstream',
        retryable: error.statusCode >= 500,
        statusCode: error.statusCode,
        details: error.details,
      });
    }

    if (error instanceof TypeError) {
      return new NormalizedProviderError({
        providerKey: ProviderKey.OPENAI,
        message: `OpenAI network request failed: ${error.message}`,
        code: 'PROVIDER_NETWORK_ERROR',
        category: 'network',
        retryable: true,
        statusCode: 502,
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

  async generateResponse(input: ProviderGenerateInput): Promise<ProviderGenerateResult> {
    if (!env.OPENAI_ENABLED) {
      throw this.classifyError(
        new AppError(
          'ChatGPT is temporarily unavailable in this deployment region. Use Claude or Gemini, or route OpenAI through a separate proxy/server in a supported region.',
          503,
          'PROVIDER_REGION_UNAVAILABLE',
        ),
      );
    }

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
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      throw this.classifyError(error);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const upstreamRequestId =
        response.headers.get('x-request-id') ?? response.headers.get('request-id');

      if (body.includes('unsupported_country_region_territory')) {
        throw this.classifyError(
          new NormalizedProviderError({
            providerKey: ProviderKey.OPENAI,
            message:
              'ChatGPT is temporarily unavailable in this deployment region. Use Claude or Gemini, or route OpenAI through a separate proxy/server in a supported region.',
            code: 'PROVIDER_REGION_UNAVAILABLE',
            category: 'region_unavailable',
            retryable: false,
            statusCode: 503,
            upstreamStatus: response.status,
            upstreamRequestId,
          }),
        );
      }

      throw this.classifyError(
        new NormalizedProviderError({
          providerKey: ProviderKey.OPENAI,
          message: `OpenAI request failed${body ? `: ${body}` : ''}`,
          code: response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_REQUEST_FAILED',
          category:
            response.status === 429
              ? 'rate_limit'
              : response.status === 401 || response.status === 403
                ? 'auth'
                : response.status >= 500
                  ? 'service_unavailable'
                  : 'upstream',
          retryable: response.status === 429 || response.status >= 500,
          statusCode: 502,
          upstreamStatus: response.status,
          upstreamRequestId,
          details: body ? { body } : undefined,
        }),
      );
    }

    const data = (await response.json()) as {
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

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw this.classifyError(new AppError('OpenAI returned empty content', 502, 'PROVIDER_EMPTY_RESPONSE'));
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
        response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? data.id ?? null,
    };
  }
}
