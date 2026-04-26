import { ProviderKey } from '@prisma/client';
import { AppError } from '../../lib/errors';
import { env } from '../../env';
import { generateGatewayChatResponse, isAiGatewayConfigured } from './gateway-client';
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

const GOOGLE_SEARCH_GROUNDING_INSTRUCTION = [
  'System instructions:',
  'Google Search grounding is enabled for this Gemini request.',
  'For questions about current, latest, recent, today, now, live data, prices, exchange rates, weather, news, sports, dates, or market data, use Google Search grounding before answering.',
  'Never answer time-sensitive questions from model memory alone.',
  'When grounding metadata is available, include concise source names or links in the answer.',
].join('\n');
const GEMINI_CHAT_MODEL_FALLBACK = 'gemini-2.5-flash';

function buildGeminiPrompt(input: ProviderGenerateInput) {
  return [
    GOOGLE_SEARCH_GROUNDING_INSTRUCTION,
    ...input.messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`),
  ].join('\n\n');
}

function buildGeminiRequestBody(input: ProviderGenerateInput, prompt: string, includeSearchGrounding: boolean) {
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

function googleGenerateContentUrl(model: string) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${normalizeGoogleModelName(model)}:generateContent`;
}

export class GeminiProviderAdapter implements AiProviderAdapter {
  readonly metadata = {
    key: ProviderKey.GEMINI,
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
    if (isAiGatewayConfigured()) {
      return generateGatewayChatResponse(input);
    }

    const prompt = buildGeminiPrompt(input);
    const requestedModel = normalizeGoogleModelName(input.model || env.GOOGLE_AI_MODEL);
    const modelCandidates = uniqueGoogleModelNames([
      requestedModel,
      env.GOOGLE_AI_MODEL,
      GEMINI_CHAT_MODEL_FALLBACK,
    ]);

    const fetchGemini = (model: string, includeSearchGrounding: boolean) =>
      fetch(googleGenerateContentUrl(model), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': env.GOOGLE_AI_API_KEY,
        },
        body: JSON.stringify(buildGeminiRequestBody(input, prompt, includeSearchGrounding)),
        signal: AbortSignal.timeout(DEFAULT_PROVIDER_TIMEOUT_MS),
      });

    const requestWithGroundingFallback = async (model: string) => {
      const groundedResponse = await fetchGemini(model, true);
      if (groundedResponse.status === 400) {
        return fetchGemini(model, false);
      }

      return groundedResponse;
    };

    let response: Response | null = null;
    try {
      for (const [index, candidateModel] of modelCandidates.entries()) {
        response = await requestWithGroundingFallback(candidateModel);
        if (response.status !== 404 || index === modelCandidates.length - 1) {
          break;
        }
      }
    } catch (error) {
      throw this.classifyError(error);
    }

    if (!response) {
      throw this.classifyError(
        createProviderEmptyResponseError({
          key: ProviderKey.GEMINI,
          label: 'Gemini',
        }),
      );
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
        groundingMetadata?: Record<string, unknown>;
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
        [key: string]: unknown;
      };
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const groundingMetadata = data.candidates?.[0]?.groundingMetadata ?? null;
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
        groundingMetadata,
      },
      usage: data.usageMetadata
        ? {
            inputTokens: data.usageMetadata.promptTokenCount ?? null,
            outputTokens: data.usageMetadata.candidatesTokenCount ?? null,
            totalTokens: data.usageMetadata.totalTokenCount ?? null,
            raw: data.usageMetadata,
          }
        : null,
      upstreamRequestId: response.headers.get('x-request-id') ?? null,
    };
  }

  async executeAsyncJob(input: ProviderAsyncJobInput): Promise<ProviderAsyncJobResult> {
    if (input.kind !== 'PROVIDER_ASYNC') {
      throw new AppError('Gemini async job kind is not supported', 400, 'PROVIDER_JOB_KIND_UNSUPPORTED');
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
