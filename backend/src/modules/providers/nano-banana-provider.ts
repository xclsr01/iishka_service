import { GenerationJobKind, ProviderKey } from '@prisma/client';
import { AppError } from '../../lib/errors';
import { env } from '../../env';
import {
  assertDirectProviderEgressAllowed,
  executeGatewayAsyncJob,
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
  createProviderTimeoutError,
  createUpstreamHttpError,
  isProviderTimeoutError,
} from './provider-error-mapping';

type NanoBananaGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType?: string;
          data?: string;
        };
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    [key: string]: unknown;
  };
};

function extensionFromMimeType(mimeType: string) {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/png':
      return 'png';
    default:
      return 'bin';
  }
}

export class NanoBananaProviderAdapter implements AiProviderAdapter {
  readonly metadata = {
    key: ProviderKey.NANO_BANANA,
    executionMode: 'async-job',
    capabilities: {
      supportsText: false,
      supportsImage: true,
      supportsStreaming: false,
      supportsAsyncJobs: true,
      supportsFiles: true,
    } satisfies ProviderCapabilitySet,
  } as const;

  classifyError(error: unknown): ProviderAdapterError {
    if (error instanceof NormalizedProviderError) {
      return error;
    }

    if (isProviderTimeoutError(error)) {
      return createProviderTimeoutError({
        key: ProviderKey.NANO_BANANA,
        label: 'Nano Banana',
      });
    }

    if (error instanceof AppError) {
      if (error.code === 'PROVIDER_EMPTY_RESPONSE') {
        return createProviderEmptyResponseError({
          key: ProviderKey.NANO_BANANA,
          label: 'Nano Banana',
        });
      }

      return new NormalizedProviderError({
        providerKey: ProviderKey.NANO_BANANA,
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
        key: ProviderKey.NANO_BANANA,
        label: 'Nano Banana',
        error,
      });
    }

    return new NormalizedProviderError({
      providerKey: ProviderKey.NANO_BANANA,
      message:
        error instanceof Error ? error.message : 'Nano Banana request failed',
      code: 'PROVIDER_REQUEST_FAILED',
      category: 'unknown',
      retryable: false,
      statusCode: 502,
    });
  }

  async generateResponse(
    _input: ProviderGenerateInput,
  ): Promise<ProviderGenerateResult> {
    throw new AppError(
      'Nano Banana image generation must be executed as an async job',
      400,
      'PROVIDER_REQUIRES_ASYNC_JOB',
    );
  }

  async executeAsyncJob(
    input: ProviderAsyncJobInput,
  ): Promise<ProviderAsyncJobResult> {
    if (isAiGatewayConfigured()) {
      return executeGatewayAsyncJob(input);
    }

    assertDirectProviderEgressAllowed(ProviderKey.NANO_BANANA, 'async_job');

    if (input.kind !== GenerationJobKind.IMAGE) {
      throw new AppError(
        'Nano Banana only supports image generation jobs',
        400,
        'PROVIDER_JOB_KIND_UNSUPPORTED',
      );
    }

    const model = input.model || env.NANO_BANANA_MODEL;
    let response: Response;

    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': env.GOOGLE_AI_API_KEY,
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: input.prompt,
                  },
                ],
              },
            ],
            generationConfig: {
              responseModalities: ['IMAGE', 'TEXT'],
            },
          }),
          signal: AbortSignal.timeout(DEFAULT_PROVIDER_TIMEOUT_MS),
        },
      );
    } catch (error) {
      throw this.classifyError(error);
    }

    const upstreamRequestId =
      response.headers.get('x-request-id') ??
      response.headers.get('request-id');

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw this.classifyError(
        createUpstreamHttpError({
          key: ProviderKey.NANO_BANANA,
          label: 'Nano Banana',
          status: response.status,
          upstreamRequestId,
          rawBody: body,
        }),
      );
    }

    const data = (await response.json()) as NanoBananaGenerateContentResponse;
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .map((part) => part.text?.trim())
      .filter((value): value is string => Boolean(value))
      .join('\n')
      .trim();
    const images = parts
      .map((part, index) => {
        const inlineData = part.inlineData;
        if (!inlineData?.data || !inlineData.mimeType) {
          return null;
        }

        return {
          index,
          mimeType: inlineData.mimeType,
          filename: `nano-banana-${input.jobId}-${index}.${extensionFromMimeType(inlineData.mimeType)}`,
          dataBase64: inlineData.data,
          sizeBytes: Buffer.from(inlineData.data, 'base64').byteLength,
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value));

    if (images.length === 0) {
      throw this.classifyError(
        createProviderEmptyResponseError({
          key: ProviderKey.NANO_BANANA,
          label: 'Nano Banana',
        }),
      );
    }

    return {
      resultPayload: {
        kind: input.kind,
        text: text || null,
        images,
      },
      usage: data.usageMetadata
        ? {
            inputTokens: data.usageMetadata.promptTokenCount ?? null,
            outputTokens: data.usageMetadata.candidatesTokenCount ?? null,
            totalTokens: data.usageMetadata.totalTokenCount ?? null,
            raw: data.usageMetadata,
          }
        : null,
      upstreamRequestId,
      externalJobId: null,
    };
  }
}
