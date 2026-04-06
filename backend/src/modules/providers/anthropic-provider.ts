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
  createProviderTimeoutError,
  createUpstreamHttpError,
  isProviderTimeoutError,
} from './provider-error-mapping';

export class AnthropicProviderAdapter implements AiProviderAdapter {
  readonly metadata = {
    key: ProviderKey.ANTHROPIC,
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

    if (isProviderTimeoutError(error)) {
      return createProviderTimeoutError({
        key: ProviderKey.ANTHROPIC,
        label: 'Anthropic',
      });
    }

    if (error instanceof AppError) {
      if (error.code === 'PROVIDER_EMPTY_RESPONSE') {
        return createProviderEmptyResponseError({
          key: ProviderKey.ANTHROPIC,
          label: 'Anthropic',
        });
      }

      return new NormalizedProviderError({
        providerKey: ProviderKey.ANTHROPIC,
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
        key: ProviderKey.ANTHROPIC,
        label: 'Anthropic',
        error,
      });
    }

    return new NormalizedProviderError({
      providerKey: ProviderKey.ANTHROPIC,
      message: error instanceof Error ? error.message : 'Anthropic request failed',
      code: 'PROVIDER_REQUEST_FAILED',
      category: 'unknown',
      retryable: false,
      statusCode: 502,
    });
  }

  async generateResponse(input: ProviderGenerateInput): Promise<ProviderGenerateResult> {
    const system = input.messages.find((message) => message.role === 'system')?.content;
    const messages = input.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    let response: Response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: input.model || env.ANTHROPIC_MODEL,
          max_tokens: 1024,
          system,
          messages,
        }),
        signal: AbortSignal.timeout(DEFAULT_PROVIDER_TIMEOUT_MS),
      });
    } catch (error) {
      throw this.classifyError(error);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw this.classifyError(
        createUpstreamHttpError({
          key: ProviderKey.ANTHROPIC,
          label: 'Anthropic',
          status: response.status,
          upstreamRequestId:
            response.headers.get('request-id') ?? response.headers.get('x-request-id'),
          rawBody: body,
        }),
      );
    }

    const data = (await response.json()) as {
      id: string;
      content?: Array<{
        type: string;
        text?: string;
      }>;
      usage?: Record<string, unknown>;
    };

    const text = data.content?.find((item) => item.type === 'text')?.text?.trim();
    if (!text) {
      throw this.classifyError(
        createProviderEmptyResponseError({
          key: ProviderKey.ANTHROPIC,
          label: 'Anthropic',
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
            inputTokens:
              typeof data.usage.input_tokens === 'number' ? data.usage.input_tokens : null,
            outputTokens:
              typeof data.usage.output_tokens === 'number' ? data.usage.output_tokens : null,
            totalTokens:
              typeof data.usage.input_tokens === 'number' ||
              typeof data.usage.output_tokens === 'number'
                ? (typeof data.usage.input_tokens === 'number' ? data.usage.input_tokens : 0) +
                  (typeof data.usage.output_tokens === 'number' ? data.usage.output_tokens : 0)
                : null,
            raw: data.usage,
          }
        : null,
      upstreamRequestId:
        response.headers.get('request-id') ?? response.headers.get('x-request-id') ?? data.id ?? null,
    };
  }
}
