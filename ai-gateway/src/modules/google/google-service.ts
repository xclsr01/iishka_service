import { env } from '../../env';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import {
  createEmptyResponseError,
  createTimeoutError,
  createUnsupportedOperationError,
} from '../gateway/provider-errors';
import { fetchProviderResponse } from '../gateway/provider-request';
import type {
  GatewayAsyncJobRequest,
  GatewayAsyncJobResponse,
  GatewayChatRespondRequest,
  GatewayChatRespondResponse,
  GatewayGeneratedFileArtifact,
  GatewayGeneratedImage,
  GatewayGeneratedVideo,
} from '../gateway/gateway-types';

type GoogleGenerateContentResponse = {
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
    groundingMetadata?: Record<string, unknown>;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    [key: string]: unknown;
  };
};

type GoogleLongRunningOperationResponse = {
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

const GOOGLE_SEARCH_GROUNDING_INSTRUCTION = [
  'System instructions:',
  'Google Search grounding is enabled for this Gemini request.',
  'For questions about current, latest, recent, today, now, live data, prices, exchange rates, weather, news, sports, dates, or market data, use Google Search grounding before answering.',
  'Never answer time-sensitive questions from model memory alone.',
  'When grounding metadata is available, include concise source names or links in the answer.',
].join('\n');
const GEMINI_CHAT_MODEL_FALLBACK = 'gemini-2.5-flash';

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '');
}

function normalizeGoogleModelName(model: string) {
  return model.trim().replace(/^\/+/, '').replace(/^models\//, '');
}

function uniqueGoogleModelNames(models: string[]) {
  const seen = new Set<string>();
  return models
    .map(normalizeGoogleModelName)
    .filter((model) => {
      if (!model || seen.has(model)) {
        return false;
      }

      seen.add(model);
      return true;
    });
}

function googleUrl(model: string) {
  return `${trimTrailingSlashes(env.GOOGLE_AI_BASE_URL)}/v1beta/models/${normalizeGoogleModelName(model)}:generateContent`;
}

function googleLongRunningUrl(model: string) {
  return `${trimTrailingSlashes(env.GOOGLE_AI_BASE_URL)}/v1beta/models/${normalizeGoogleModelName(model)}:predictLongRunning`;
}

function googleOperationUrl(operationName: string) {
  return `${trimTrailingSlashes(env.GOOGLE_AI_BASE_URL)}/v1beta/${operationName.replace(/^\/+/, '')}`;
}

function usageFromGoogle(data: GoogleGenerateContentResponse) {
  return data.usageMetadata
    ? {
        inputTokens: data.usageMetadata.promptTokenCount ?? null,
        outputTokens: data.usageMetadata.candidatesTokenCount ?? null,
        totalTokens: data.usageMetadata.totalTokenCount ?? null,
        raw: data.usageMetadata,
      }
    : null;
}

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

function normalizeVeoParameters(metadata?: Record<string, unknown>) {
  return {
    aspectRatio: typeof metadata?.aspectRatio === 'string' ? metadata.aspectRatio : '9:16',
    durationSeconds: normalizeDurationSeconds(metadata?.durationSeconds),
    resolution: typeof metadata?.resolution === 'string' ? metadata.resolution : '720p',
    negativePrompt: typeof metadata?.negativePrompt === 'string' ? metadata.negativePrompt : undefined,
    personGeneration:
      typeof metadata?.personGeneration === 'string' ? metadata.personGeneration : 'allow_all',
    seed: typeof metadata?.seed === 'number' ? metadata.seed : undefined,
  };
}

function extractGeneratedVideo(operation: GoogleLongRunningOperationResponse) {
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

function buildGeminiChatPrompt(input: GatewayChatRespondRequest) {
  return [
    GOOGLE_SEARCH_GROUNDING_INSTRUCTION,
    ...input.messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`),
  ].join('\n\n');
}

function buildGeminiChatBody(input: GatewayChatRespondRequest, prompt: string, includeSearchGrounding: boolean) {
  const generationConfig: Record<string, number> = {};
  if (typeof input.temperature === 'number') {
    generationConfig.temperature = input.temperature;
  }
  if (typeof input.maxOutputTokens === 'number') {
    generationConfig.maxOutputTokens = input.maxOutputTokens;
  }

  return {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: prompt,
          },
        ],
      },
    ],
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    ...(includeSearchGrounding
      ? {
          tools: [
            {
              google_search: {},
            },
          ],
        }
      : {}),
  };
}

function shouldRetryGeminiWithoutGrounding(error: unknown) {
  return (
    error instanceof AppError &&
    error.code === 'PROVIDER_BAD_REQUEST' &&
    error.upstreamStatus === 400 &&
    error.retryable === false
  );
}

function shouldRetryGeminiWithDefaultModel(error: unknown) {
  return (
    error instanceof AppError &&
    error.code === 'PROVIDER_BAD_REQUEST' &&
    error.upstreamStatus === 404 &&
    error.retryable === false
  );
}

export async function respondWithGemini(
  input: GatewayChatRespondRequest,
  routeRequestId: string,
): Promise<GatewayChatRespondResponse> {
  const provider = 'gemini';
  const requestedModel = normalizeGoogleModelName(input.model || env.GOOGLE_AI_DEFAULT_MODEL);
  const modelCandidates = uniqueGoogleModelNames([
    requestedModel,
    env.GOOGLE_AI_DEFAULT_MODEL,
    GEMINI_CHAT_MODEL_FALLBACK,
  ]);
  const prompt = buildGeminiChatPrompt(input);

  logger.info('provider_gateway_request_started', {
    route: '/v1/providers/gemini/chat/respond',
    requestId: routeRequestId,
    provider,
    model: requestedModel,
    userId: input.userId ?? null,
    chatId: input.chatId ?? null,
    messageCount: input.messages.length,
  });

  let groundingFallbackUsed = false;
  let modelFallbackUsed = false;
  let model = requestedModel;

  const fetchGeminiChatResponse = async (
    targetModel: string,
    includeSearchGrounding: boolean,
    suppressFailureLog = false,
  ) =>
    fetchProviderResponse({
      provider,
      route: '/v1/providers/gemini/chat/respond',
      requestId: routeRequestId,
      model: targetModel,
      url: googleUrl(targetModel),
      userId: input.userId,
      chatId: input.chatId,
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': env.GOOGLE_AI_API_KEY,
        },
        body: JSON.stringify(buildGeminiChatBody(input, prompt, includeSearchGrounding)),
      },
      suppressFailureLog,
    });

  const runGeminiChatRequest = async (targetModel: string, suppressInitialFailureLog: boolean) => {
    try {
      return await fetchGeminiChatResponse(targetModel, true, suppressInitialFailureLog);
    } catch (error) {
      if (!shouldRetryGeminiWithoutGrounding(error)) {
        throw error;
      }

      const appError = error as AppError;
      groundingFallbackUsed = true;
      logger.info('provider_grounding_fallback_scheduled', {
        route: '/v1/providers/gemini/chat/respond',
        requestId: routeRequestId,
        provider,
        model: targetModel,
        userId: input.userId ?? null,
        chatId: input.chatId ?? null,
        upstreamStatus: appError.upstreamStatus ?? null,
        upstreamRequestId: appError.upstreamRequestId ?? null,
        details: appError.details ?? null,
      });

      return fetchGeminiChatResponse(targetModel, false);
    }
  };

  let response: Response | null = null;
  let lastModelError: unknown = null;
  for (const [index, candidateModel] of modelCandidates.entries()) {
    try {
      response = await runGeminiChatRequest(candidateModel, index < modelCandidates.length - 1);
      model = candidateModel;
      lastModelError = null;
      break;
    } catch (error) {
      if (!shouldRetryGeminiWithDefaultModel(error) || index === modelCandidates.length - 1) {
        throw error;
      }

      const appError = error as AppError;
      const fallbackModel = modelCandidates[index + 1] ?? null;
      modelFallbackUsed = true;
      lastModelError = error;
      logger.info('provider_model_fallback_scheduled', {
        route: '/v1/providers/gemini/chat/respond',
        requestId: routeRequestId,
        provider,
        model: candidateModel,
        fallbackModel,
        userId: input.userId ?? null,
        chatId: input.chatId ?? null,
        upstreamStatus: appError.upstreamStatus ?? null,
        upstreamRequestId: appError.upstreamRequestId ?? null,
        details: appError.details ?? null,
      });
    }
  }

  if (!response) {
    if (lastModelError) {
      throw lastModelError;
    }

    throw createEmptyResponseError(provider);
  }

  const upstreamRequestId = response.headers.get('x-request-id') ?? response.headers.get('request-id');
  const data = (await response.json()) as GoogleGenerateContentResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  const groundingMetadata = data.candidates?.[0]?.groundingMetadata ?? null;

  logger.info('provider_grounding_completed', {
    route: '/v1/providers/gemini/chat/respond',
    requestId: routeRequestId,
    provider,
    model,
    userId: input.userId ?? null,
    chatId: input.chatId ?? null,
    googleSearchEnabled: true,
    groundingReturned: Boolean(groundingMetadata),
    groundingFallbackUsed,
    modelFallbackUsed,
    groundingChunkCount: Array.isArray(groundingMetadata?.groundingChunks)
      ? groundingMetadata.groundingChunks.length
      : 0,
    groundingSupportCount: Array.isArray(groundingMetadata?.groundingSupports)
      ? groundingMetadata.groundingSupports.length
      : 0,
    webSearchQueryCount: Array.isArray(groundingMetadata?.webSearchQueries)
      ? groundingMetadata.webSearchQueries.length
      : 0,
  });

  if (!text) {
    throw createEmptyResponseError(provider);
  }

  return {
    provider,
    model,
    text,
    upstreamRequestId,
    usage: usageFromGoogle(data),
    raw: {
      usage: data.usageMetadata ?? null,
      groundingMetadata,
    },
  };
}

export async function executeNanoBananaJob(
  input: GatewayAsyncJobRequest,
  routeRequestId: string,
): Promise<GatewayAsyncJobResponse> {
  const provider = 'nano-banana';
  const model = input.model || env.NANO_BANANA_DEFAULT_MODEL;

  if (input.kind !== 'IMAGE') {
    throw createUnsupportedOperationError(provider, `${input.kind} jobs`);
  }

  logger.info('provider_gateway_job_started', {
    route: '/v1/providers/nano-banana/jobs/execute',
    requestId: routeRequestId,
    provider,
    model,
    userId: input.userId ?? null,
    chatId: input.chatId ?? null,
    jobId: input.jobId ?? null,
    kind: input.kind,
  });

  const response = await fetchProviderResponse({
    provider,
    route: '/v1/providers/nano-banana/jobs/execute',
    requestId: routeRequestId,
    model,
    url: googleUrl(model),
    init: {
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
    },
    userId: input.userId,
    chatId: input.chatId,
    jobId: input.jobId,
  });

  const upstreamRequestId = response.headers.get('x-request-id') ?? response.headers.get('request-id');
  const data = (await response.json()) as GoogleGenerateContentResponse;
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) => part.text?.trim())
    .filter((value): value is string => Boolean(value))
    .join('\n')
    .trim();
  const images = parts
    .map((part, index): GatewayGeneratedImage | null => {
      const inlineData = part.inlineData;
      if (!inlineData?.data || !inlineData.mimeType) {
        return null;
      }

      return {
        index,
        mimeType: inlineData.mimeType,
        filename: `nano-banana-${input.jobId ?? routeRequestId}-${index}.${extensionFromMimeType(inlineData.mimeType)}`,
        dataBase64: inlineData.data,
        sizeBytes: Buffer.from(inlineData.data, 'base64').byteLength,
      };
    })
    .filter((value): value is GatewayGeneratedImage => Boolean(value));

  if (images.length === 0) {
    throw createEmptyResponseError(provider);
  }

  return {
    provider,
    model,
    resultPayload: {
      kind: input.kind,
      text: text || null,
      images,
    },
    upstreamRequestId,
    externalJobId: null,
    usage: usageFromGoogle(data),
  };
}

export async function executeVeoJob(
  input: GatewayAsyncJobRequest,
  routeRequestId: string,
): Promise<GatewayAsyncJobResponse> {
  const provider = 'veo';
  const model = input.model || env.VEO_DEFAULT_MODEL;

  if (input.kind !== 'VIDEO') {
    throw createUnsupportedOperationError(provider, `${input.kind} jobs`);
  }

  const parameters = normalizeVeoParameters(input.metadata);

  logger.info('provider_gateway_job_started', {
    route: '/v1/providers/veo/jobs/execute',
    requestId: routeRequestId,
    provider,
    model,
    userId: input.userId ?? null,
    chatId: input.chatId ?? null,
    jobId: input.jobId ?? null,
    kind: input.kind,
  });

  const startResponse = await fetchProviderResponse({
    provider,
    route: '/v1/providers/veo/jobs/execute',
    requestId: routeRequestId,
    model,
    url: googleLongRunningUrl(model),
    init: {
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
        parameters,
      }),
    },
    userId: input.userId,
    chatId: input.chatId,
    jobId: input.jobId,
  });

  let upstreamRequestId =
    startResponse.headers.get('x-request-id') ?? startResponse.headers.get('request-id');
  let operation = (await startResponse.json()) as GoogleLongRunningOperationResponse;
  const operationName = operation.name;

  if (!operationName && !operation.done) {
    throw createEmptyResponseError(provider);
  }

  const startedAt = Date.now();
  while (!operation.done) {
    if (Date.now() - startedAt > 10 * 60 * 1000) {
      throw createTimeoutError(provider);
    }

    await sleep(10_000);

    const statusResponse = await fetchProviderResponse({
      provider,
      route: '/v1/providers/veo/jobs/execute',
      requestId: routeRequestId,
      model,
      url: googleOperationUrl(operationName!),
      init: {
        method: 'GET',
        headers: {
          'x-goog-api-key': env.GOOGLE_AI_API_KEY,
        },
      },
      userId: input.userId,
      chatId: input.chatId,
      jobId: input.jobId,
    });

    upstreamRequestId =
      upstreamRequestId ??
      statusResponse.headers.get('x-request-id') ??
      statusResponse.headers.get('request-id');
    operation = (await statusResponse.json()) as GoogleLongRunningOperationResponse;
  }

  if (operation.error?.message) {
    throw createUnsupportedOperationError(provider, operation.error.message);
  }

  const generatedVideo = extractGeneratedVideo(operation);
  const videoUri = generatedVideo?.uri;
  if (!videoUri) {
    throw createEmptyResponseError(provider);
  }

  const downloadResponse = await fetchProviderResponse({
    provider,
    route: '/v1/providers/veo/jobs/execute',
    requestId: routeRequestId,
    model,
    url: videoUri,
    init: {
      method: 'GET',
      headers: {
        'x-goog-api-key': env.GOOGLE_AI_API_KEY,
      },
    },
    userId: input.userId,
    chatId: input.chatId,
    jobId: input.jobId,
  });

  upstreamRequestId =
    upstreamRequestId ??
    downloadResponse.headers.get('x-request-id') ??
    downloadResponse.headers.get('request-id');

  const bytes = new Uint8Array(await downloadResponse.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw createEmptyResponseError(provider);
  }

  const mimeType = (downloadResponse.headers.get('content-type') ?? generatedVideo.mimeType ?? 'video/mp4')
    .split(';')[0]
    .trim();
  const filename = `veo-${input.jobId ?? routeRequestId}-0.${extensionFromMimeType(mimeType)}`;
  const videoMetadata = {
    aspectRatio: parameters.aspectRatio,
    durationSeconds: parameters.durationSeconds,
    resolution: parameters.resolution,
  };
  const videos: GatewayGeneratedVideo[] = [
    {
      index: 0,
      mimeType,
      filename,
      sizeBytes: bytes.byteLength,
      metadata: videoMetadata,
    },
  ];
  const artifacts: GatewayGeneratedFileArtifact[] = [
    {
      kind: 'file',
      role: 'video',
      filename,
      mimeType,
      dataBase64: Buffer.from(bytes).toString('base64'),
      sizeBytes: bytes.byteLength,
      metadata: videoMetadata,
    },
  ];

  return {
    provider,
    model,
    resultPayload: {
      kind: input.kind,
      text: null,
      videos,
    },
    artifacts,
    upstreamRequestId: upstreamRequestId ?? null,
    externalJobId: operationName ?? null,
    usage: null,
  };
}
