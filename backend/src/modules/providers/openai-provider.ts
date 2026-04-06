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
import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  createProviderEmptyResponseError,
  createProviderNetworkError,
  createProviderRegionUnavailableError,
  createProviderTimeoutError,
  createUpstreamHttpError,
  isProviderTimeoutError,
} from './provider-error-mapping';

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
        signal: AbortSignal.timeout(DEFAULT_PROVIDER_TIMEOUT_MS),
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
        response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? data.id ?? null,
    };
  }
}
