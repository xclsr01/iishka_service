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

    if (error instanceof Error && error.name === 'TimeoutError') {
      return new NormalizedProviderError({
        providerKey: ProviderKey.GEMINI,
        message: 'Gemini request timed out',
        code: 'PROVIDER_TIMEOUT',
        category: 'timeout',
        retryable: true,
        statusCode: 504,
      });
    }

    if (error instanceof AppError) {
      return new NormalizedProviderError({
        providerKey: ProviderKey.GEMINI,
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
        providerKey: ProviderKey.GEMINI,
        message: `Gemini network request failed: ${error.message}`,
        code: 'PROVIDER_NETWORK_ERROR',
        category: 'network',
        retryable: true,
        statusCode: 502,
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
          signal: AbortSignal.timeout(15000),
        },
      );
    } catch (error) {
      throw this.classifyError(error);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw this.classifyError(
        new NormalizedProviderError({
          providerKey: ProviderKey.GEMINI,
          message: `Gemini request failed${body ? `: ${body}` : ''}`,
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
          details: body ? { body } : undefined,
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
        new AppError('Gemini returned empty content', 502, 'PROVIDER_EMPTY_RESPONSE'),
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
