import { env } from '../../env';
import { logger } from '../../lib/logger';
import { createEmptyResponseError, createUnsupportedOperationError } from '../gateway/provider-errors';
import { fetchProviderResponse } from '../gateway/provider-request';
import type {
  GatewayAsyncJobRequest,
  GatewayAsyncJobResponse,
  GatewayChatRespondRequest,
  GatewayChatRespondResponse,
  GatewayGeneratedImage,
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
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    [key: string]: unknown;
  };
};

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '');
}

function googleUrl(model: string) {
  return `${trimTrailingSlashes(env.GOOGLE_AI_BASE_URL)}/v1beta/models/${model}:generateContent`;
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

export async function respondWithGemini(
  input: GatewayChatRespondRequest,
  routeRequestId: string,
): Promise<GatewayChatRespondResponse> {
  const provider = 'gemini';
  const model = input.model || env.GOOGLE_AI_DEFAULT_MODEL;
  const prompt = input.messages
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join('\n\n');

  logger.info('provider_gateway_request_started', {
    route: '/v1/providers/gemini/chat/respond',
    requestId: routeRequestId,
    provider,
    model,
    userId: input.userId ?? null,
    chatId: input.chatId ?? null,
    messageCount: input.messages.length,
  });

  const response = await fetchProviderResponse({
    provider,
    route: '/v1/providers/gemini/chat/respond',
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
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
      }),
    },
    userId: input.userId,
    chatId: input.chatId,
  });

  const upstreamRequestId = response.headers.get('x-request-id') ?? response.headers.get('request-id');
  const data = (await response.json()) as GoogleGenerateContentResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

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
