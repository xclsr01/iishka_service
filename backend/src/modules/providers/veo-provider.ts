import { GenerationJobKind, ProviderKey } from '@prisma/client';
import { AppError } from '../../lib/errors';
import { env } from '../../env';
import { executeGatewayAsyncJob, isAiGatewayConfigured } from './gateway-client';
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

const GOOGLE_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const VEO_OPERATION_POLL_INTERVAL_MS = 10_000;
const VEO_OPERATION_TIMEOUT_MS = 10 * 60 * 1000;

type VeoOperationResponse = {
  name?: string;
  done?: boolean;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
  response?: {
    generatedVideos?: Array<{
      video?: {
        uri?: string;
        mimeType?: string;
      };
    }>;
    generateVideoResponse?: {
      generatedSamples?: Array<{
        video?: {
          uri?: string;
          mimeType?: string;
        };
      }>;
    };
  };
};

type VeoGenerationMetadata = {
  aspectRatio?: string;
  durationSeconds?: number;
  resolution?: string;
  negativePrompt?: string;
  personGeneration?: string;
  seed?: number;
};

function extensionFromMimeType(mimeType: string) {
  switch (mimeType) {
    case 'video/mp4':
      return 'mp4';
    case 'video/webm':
      return 'webm';
    case 'video/quicktime':
      return 'mov';
    default:
      return 'bin';
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDurationSeconds(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed);
    }
  }

  return 4;
}

function normalizeMetadata(metadata?: Record<string, unknown>): VeoGenerationMetadata {
  const aspectRatio = typeof metadata?.aspectRatio === 'string' ? metadata.aspectRatio : '16:9';
  const durationSeconds = normalizeDurationSeconds(metadata?.durationSeconds);
  const resolution = typeof metadata?.resolution === 'string' ? metadata.resolution : '720p';
  const negativePrompt = typeof metadata?.negativePrompt === 'string' ? metadata.negativePrompt : undefined;
  const personGeneration =
    typeof metadata?.personGeneration === 'string' ? metadata.personGeneration : 'allow_all';
  const seed = typeof metadata?.seed === 'number' ? metadata.seed : undefined;

  return {
    aspectRatio,
    durationSeconds,
    resolution,
    negativePrompt,
    personGeneration,
    seed,
  };
}

function operationUrl(operationName: string) {
  return `${GOOGLE_API_BASE_URL}/${operationName.replace(/^\/+/, '')}`;
}

function extractGeneratedVideo(operation: VeoOperationResponse) {
  const modernVideo = operation.response?.generatedVideos?.[0]?.video;
  if (modernVideo?.uri) {
    return modernVideo;
  }

  const legacyVideo = operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video;
  if (legacyVideo?.uri) {
    return legacyVideo;
  }

  return null;
}

export class VeoProviderAdapter implements AiProviderAdapter {
  readonly metadata = {
    key: ProviderKey.VEO,
    executionMode: 'async-job',
    capabilities: {
      supportsText: false,
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

    if (isProviderTimeoutError(error)) {
      return createProviderTimeoutError({
        key: ProviderKey.VEO,
        label: 'Veo',
      });
    }

    if (error instanceof AppError) {
      if (error.code === 'PROVIDER_EMPTY_RESPONSE') {
        return createProviderEmptyResponseError({
          key: ProviderKey.VEO,
          label: 'Veo',
        });
      }

      return new NormalizedProviderError({
        providerKey: ProviderKey.VEO,
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
        key: ProviderKey.VEO,
        label: 'Veo',
        error,
      });
    }

    return new NormalizedProviderError({
      providerKey: ProviderKey.VEO,
      message: error instanceof Error ? error.message : 'Veo request failed',
      code: 'PROVIDER_REQUEST_FAILED',
      category: 'unknown',
      retryable: false,
      statusCode: 502,
    });
  }

  async generateResponse(_input: ProviderGenerateInput): Promise<ProviderGenerateResult> {
    throw new AppError(
      'Veo video generation must be executed as an async job',
      400,
      'PROVIDER_REQUIRES_ASYNC_JOB',
    );
  }

  async executeAsyncJob(input: ProviderAsyncJobInput): Promise<ProviderAsyncJobResult> {
    if (isAiGatewayConfigured()) {
      return executeGatewayAsyncJob(input);
    }

    if (input.kind !== GenerationJobKind.VIDEO) {
      throw new AppError(
        'Veo only supports video generation jobs',
        400,
        'PROVIDER_JOB_KIND_UNSUPPORTED',
      );
    }

    const model = input.model || env.VEO_MODEL;
    const generationMetadata = normalizeMetadata(input.metadata);
    const startUrl = `${GOOGLE_API_BASE_URL}/models/${model}:predictLongRunning`;

    let startResponse: Response;
    try {
      startResponse = await fetch(startUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': env.GOOGLE_AI_API_KEY,
        },
        body: JSON.stringify({
          instances: [
            {
              prompt: input.prompt,
            },
          ],
          parameters: generationMetadata,
        }),
        signal: AbortSignal.timeout(DEFAULT_PROVIDER_TIMEOUT_MS),
      });
    } catch (error) {
      throw this.classifyError(error);
    }

    let upstreamRequestId =
      startResponse.headers.get('x-request-id') ??
      startResponse.headers.get('request-id') ??
      null;

    if (!startResponse.ok) {
      const body = await startResponse.text().catch(() => '');
      throw this.classifyError(
        createUpstreamHttpError({
          key: ProviderKey.VEO,
          label: 'Veo',
          status: startResponse.status,
          upstreamRequestId,
          rawBody: body,
        }),
      );
    }

    let operation = (await startResponse.json()) as VeoOperationResponse;
    const operationName = operation.name;

    if (!operationName && !operation.done) {
      throw this.classifyError(
        createProviderEmptyResponseError({
          key: ProviderKey.VEO,
          label: 'Veo',
        }),
      );
    }

    const operationStartedAt = Date.now();
    while (!operation.done) {
      if (Date.now() - operationStartedAt > VEO_OPERATION_TIMEOUT_MS) {
        throw this.classifyError(
          createProviderTimeoutError({
            key: ProviderKey.VEO,
            label: 'Veo',
          }),
        );
      }

      await sleep(VEO_OPERATION_POLL_INTERVAL_MS);

      let statusResponse: Response;
      try {
        statusResponse = await fetch(operationUrl(operationName!), {
          method: 'GET',
          headers: {
            'x-goog-api-key': env.GOOGLE_AI_API_KEY,
          },
          signal: AbortSignal.timeout(DEFAULT_PROVIDER_TIMEOUT_MS),
        });
      } catch (error) {
        throw this.classifyError(error);
      }

      upstreamRequestId =
        upstreamRequestId ??
        statusResponse.headers.get('x-request-id') ??
        statusResponse.headers.get('request-id') ??
        null;

      if (!statusResponse.ok) {
        const body = await statusResponse.text().catch(() => '');
        throw this.classifyError(
          createUpstreamHttpError({
            key: ProviderKey.VEO,
            label: 'Veo',
            status: statusResponse.status,
            upstreamRequestId,
            rawBody: body,
          }),
        );
      }

      operation = (await statusResponse.json()) as VeoOperationResponse;
    }

    if (operation.error?.message) {
      throw this.classifyError(
        new AppError(
          operation.error.message,
          502,
          operation.error.code === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_REQUEST_FAILED',
          {
            upstreamStatus: operation.error.status ?? null,
            upstreamCode: operation.error.code ?? null,
          },
        ),
      );
    }

    const generatedVideo = extractGeneratedVideo(operation);
    const videoUri = generatedVideo?.uri;

    if (!videoUri) {
      throw this.classifyError(
        createProviderEmptyResponseError({
          key: ProviderKey.VEO,
          label: 'Veo',
        }),
      );
    }

    let downloadResponse: Response;
    try {
      downloadResponse = await fetch(videoUri, {
        method: 'GET',
        headers: {
          'x-goog-api-key': env.GOOGLE_AI_API_KEY,
        },
        signal: AbortSignal.timeout(DEFAULT_PROVIDER_TIMEOUT_MS),
      });
    } catch (error) {
      throw this.classifyError(error);
    }

    upstreamRequestId =
      upstreamRequestId ??
      downloadResponse.headers.get('x-request-id') ??
      downloadResponse.headers.get('request-id') ??
      null;

    if (!downloadResponse.ok) {
      const body = await downloadResponse.text().catch(() => '');
      throw this.classifyError(
        createUpstreamHttpError({
          key: ProviderKey.VEO,
          label: 'Veo',
          status: downloadResponse.status,
          upstreamRequestId,
          rawBody: body,
        }),
      );
    }

    const bytes = new Uint8Array(await downloadResponse.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw this.classifyError(
        createProviderEmptyResponseError({
          key: ProviderKey.VEO,
          label: 'Veo',
        }),
      );
    }

    const mimeType = (downloadResponse.headers.get('content-type') ?? generatedVideo.mimeType ?? 'video/mp4')
      .split(';')[0]
      .trim();
    const filename = `veo-${input.jobId}-0.${extensionFromMimeType(mimeType)}`;
    const normalizedMetadata = {
      aspectRatio: generationMetadata.aspectRatio,
      durationSeconds: generationMetadata.durationSeconds,
      resolution: generationMetadata.resolution,
    };

    return {
      resultPayload: {
        kind: input.kind,
        text: null,
        videos: [
          {
            index: 0,
            mimeType,
            filename,
            sizeBytes: bytes.byteLength,
            metadata: normalizedMetadata,
          },
        ],
      },
      artifacts: [
        {
          kind: 'file',
          role: 'video',
          filename,
          mimeType,
          bytes,
          sizeBytes: bytes.byteLength,
          metadata: normalizedMetadata,
        },
      ],
      usage: null,
      upstreamRequestId,
      externalJobId: operationName ?? null,
    };
  }
}
