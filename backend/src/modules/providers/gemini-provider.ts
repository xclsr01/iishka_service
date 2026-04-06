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

export class GeminiProviderAdapter implements AiProviderAdapter {
  readonly metadata = {
    key: ProviderKey.GEMINI,
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
        key: ProviderKey.GEMINI,
        label: 'Gemini',
      });
    }

    if (error instanceof AppError) {
      if (error.code === 'PROVIDER_EMPTY_RESPONSE') {
        return createProviderEmptyResponseError({
          key: ProviderKey.GEMINI,
          label: 'Gemini',
        });
      }

      return new NormalizedProviderError({
        providerKey: ProviderKey.GEMINI,
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
        key: ProviderKey.GEMINI,
        label: 'Gemini',
        error,
      });
    }

    return new NormalizedProviderError({
      providerKey: ProviderKey.GEMINI,
      message: error instanceof Error ? error.message : 'Gemini request failed',
      code: 'PROVIDER_REQUEST_FAILED',
      category: 'unknown',
      retryable: false,
      statusCode: 502,
    });
  }

  async generateResponse(input: ProviderGenerateInput): Promise<ProviderGenerateResult> {
    const prompt = input.messages
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n\n');

    let response: Response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${
          input.model || env.GOOGLE_AI_MODEL
        }:generateContent?key=${env.GOOGLE_AI_API_KEY}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: prompt,
                  },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(DEFAULT_PROVIDER_TIMEOUT_MS),
        },
      );
    } catch (error) {
      throw this.classifyError(error);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw this.classifyError(
        createUpstreamHttpError({
          key: ProviderKey.GEMINI,
          label: 'Gemini',
          status: response.status,
          rawBody: body,
        }),
      );
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
      usageMetadata?: Record<string, unknown>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      throw this.classifyError(
        createProviderEmptyResponseError({
          key: ProviderKey.GEMINI,
          label: 'Gemini',
        }),
      );
    }

    return {
      text,
      raw: {
        usage: data.usageMetadata ?? null,
      },
      usage: data.usageMetadata
        ? {
            raw: data.usageMetadata,
          }
        : null,
      upstreamRequestId: response.headers.get('x-request-id') ?? null,
    };
  }
}
