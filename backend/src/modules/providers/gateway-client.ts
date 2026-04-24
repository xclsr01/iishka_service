import { ProviderKey, type GenerationJobKind } from '@prisma/client';
import { env } from '../../env';
import { getLogContext } from '../../lib/request-context';
import {
  createProviderEmptyResponseError,
  createProviderNetworkError,
  createProviderTimeoutError,
} from './provider-error-mapping';
import {
  ProviderAdapterError,
  type ProviderAsyncJobResult,
  type ProviderGenerateResult,
} from './provider-types';
import type {
  ProviderChatMessage,
  ProviderGeneratedFileArtifact,
  ProviderUsage,
} from './provider-types';

type GatewayProviderSlug = 'openai' | 'anthropic' | 'gemini' | 'nano-banana' | 'veo';

type GatewayErrorResponse = {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
};

type GatewayUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  requestUnits?: number | null;
  raw?: Record<string, unknown> | null;
};

type GatewayChatResponse = {
  provider?: GatewayProviderSlug;
  model?: string;
  text?: string;
  upstreamRequestId?: string | null;
  usage?: GatewayUsage | null;
  raw?: Record<string, unknown>;
};

type GatewayAsyncJobResponse = {
  provider?: GatewayProviderSlug;
  model?: string;
  resultPayload?: Record<string, unknown>;
  artifacts?: Array<{
    kind: 'file';
    role: 'video' | 'image' | 'audio' | 'other';
    filename: string;
    mimeType: string;
    dataBase64: string;
    sizeBytes: number;
    metadata?: Record<string, unknown> | null;
  }>;
  upstreamRequestId?: string | null;
  externalJobId?: string | null;
  usage?: GatewayUsage | null;
};

type GatewayChatInput = {
  providerKey: ProviderKey;
  model: string;
  messages: ProviderChatMessage[];
  chatId?: string;
  userId?: string;
};

type GatewayAsyncJobInput = {
  providerKey: ProviderKey;
  jobId: string;
  kind: GenerationJobKind;
  model: string;
  prompt: string;
  chatId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
};

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '');
}

export function isAiGatewayConfigured() {
  return Boolean(env.AI_GATEWAY_URL);
}

function providerSlug(providerKey: ProviderKey): GatewayProviderSlug {
  switch (providerKey) {
    case ProviderKey.OPENAI:
      return 'openai';
    case ProviderKey.ANTHROPIC:
      return 'anthropic';
    case ProviderKey.GEMINI:
      return 'gemini';
    case ProviderKey.NANO_BANANA:
      return 'nano-banana';
    case ProviderKey.VEO:
      return 'veo';
    default:
      throw new ProviderAdapterError({
        providerKey,
        message: 'Provider is not supported by the AI gateway',
        code: 'PROVIDER_GATEWAY_UNSUPPORTED',
        category: 'bad_request',
        retryable: false,
        statusCode: 500,
      });
  }
}

function providerLabel(providerKey: ProviderKey) {
  switch (providerKey) {
    case ProviderKey.OPENAI:
      return 'OpenAI gateway';
    case ProviderKey.ANTHROPIC:
      return 'Anthropic gateway';
    case ProviderKey.GEMINI:
      return 'Gemini gateway';
    case ProviderKey.NANO_BANANA:
      return 'Nano Banana gateway';
    case ProviderKey.VEO:
      return 'Veo gateway';
    default:
      return 'AI gateway';
  }
}

function mapGatewayErrorCategory(status: number, code?: string) {
  if (code === 'PROVIDER_TIMEOUT') {
    return 'timeout' as const;
  }

  if (code === 'PROVIDER_RATE_LIMITED') {
    return 'rate_limit' as const;
  }

  if (code === 'GATEWAY_UNAUTHORIZED') {
    return 'auth' as const;
  }

  if (code === 'PROVIDER_EMPTY_RESPONSE') {
    return 'empty_response' as const;
  }

  if (status === 401 || status === 403) {
    return 'auth' as const;
  }

  if (status >= 400 && status < 500) {
    return 'bad_request' as const;
  }

  if (status >= 500) {
    return 'service_unavailable' as const;
  }

  return 'upstream' as const;
}

function mapGatewayError(input: {
  providerKey: ProviderKey;
  status: number;
  code?: string;
  message?: string;
  requestId?: string | null;
}) {
  if (input.code === 'PROVIDER_TIMEOUT') {
    return createProviderTimeoutError({
      key: input.providerKey,
      label: providerLabel(input.providerKey),
    });
  }

  if (input.code === 'PROVIDER_EMPTY_RESPONSE') {
    return createProviderEmptyResponseError({
      key: input.providerKey,
      label: providerLabel(input.providerKey),
    });
  }

  return new ProviderAdapterError({
    providerKey: input.providerKey,
    message: input.message || `${providerLabel(input.providerKey)} request failed`,
    code: input.code?.startsWith('PROVIDER_') ? input.code : 'PROVIDER_REQUEST_FAILED',
    category: mapGatewayErrorCategory(input.status, input.code),
    retryable: input.status === 408 || input.status === 429 || input.status >= 500,
    statusCode: 502,
    upstreamStatus: input.status,
    upstreamRequestId: input.requestId ?? null,
  });
}

async function requestGateway<T>(providerKey: ProviderKey, path: string, body: Record<string, unknown>) {
  if (!env.AI_GATEWAY_URL || !env.AI_GATEWAY_INTERNAL_TOKEN) {
    throw new ProviderAdapterError({
      providerKey,
      message: 'AI gateway is not configured',
      code: 'PROVIDER_GATEWAY_NOT_CONFIGURED',
      category: 'service_unavailable',
      retryable: false,
      statusCode: 500,
    });
  }

  const requestId = getLogContext().requestId;
  let response: Response;
  const timeoutMs = path.includes('/jobs/')
    ? env.AI_GATEWAY_ASYNC_JOB_TIMEOUT_MS
    : env.AI_GATEWAY_TIMEOUT_MS;

  try {
    response = await fetch(`${trimTrailingSlashes(env.AI_GATEWAY_URL)}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.AI_GATEWAY_INTERNAL_TOKEN}`,
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      body: JSON.stringify({
        ...body,
        requestId,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw createProviderTimeoutError({
        key: providerKey,
        label: providerLabel(providerKey),
      });
    }

    if (error instanceof TypeError) {
      throw createProviderNetworkError({
        key: providerKey,
        label: providerLabel(providerKey),
        error,
      });
    }

    throw error;
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as GatewayErrorResponse | null;
    throw mapGatewayError({
      providerKey,
      status: response.status,
      code: payload?.error?.code,
      message: payload?.error?.message,
      requestId:
        response.headers.get('x-request-id') ??
        response.headers.get('request-id') ??
        payload?.error?.requestId ??
        null,
    });
  }

  return (await response.json()) as T;
}

function mapUsage(usage?: GatewayUsage | null): ProviderUsage | null {
  if (!usage) {
    return null;
  }

  const mapped: ProviderUsage = {
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    totalTokens: usage.totalTokens ?? null,
    raw: usage.raw ?? null,
  };

  if (usage.requestUnits !== undefined) {
    mapped.requestUnits = usage.requestUnits;
  }

  return mapped;
}

function mapArtifacts(
  artifacts?: GatewayAsyncJobResponse['artifacts'],
): ProviderGeneratedFileArtifact[] | undefined {
  if (!artifacts || artifacts.length === 0) {
    return undefined;
  }

  return artifacts.map((artifact) => ({
    kind: artifact.kind,
    role: artifact.role,
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    bytes: new Uint8Array(Buffer.from(artifact.dataBase64, 'base64')),
    sizeBytes: artifact.sizeBytes,
    metadata: artifact.metadata ?? null,
  }));
}

export async function generateGatewayChatResponse(input: GatewayChatInput): Promise<ProviderGenerateResult> {
  const slug = providerSlug(input.providerKey);
  const data = await requestGateway<GatewayChatResponse>(
    input.providerKey,
    `/v1/providers/${slug}/chat/respond`,
    {
      model: input.model,
      messages: input.messages,
      userId: input.userId,
      chatId: input.chatId,
    },
  );
  const text = data.text?.trim();

  if (!text) {
    throw createProviderEmptyResponseError({
      key: input.providerKey,
      label: providerLabel(input.providerKey),
    });
  }

  return {
    text,
    raw: {
      gateway: true,
      gatewayProvider: data.provider ?? slug,
      gatewayModel: data.model ?? input.model,
      ...(data.raw ?? {}),
    },
    usage: mapUsage(data.usage),
    upstreamRequestId: data.upstreamRequestId ?? null,
  };
}

export async function executeGatewayAsyncJob(input: GatewayAsyncJobInput): Promise<ProviderAsyncJobResult> {
  const slug = providerSlug(input.providerKey);
  const data = await requestGateway<GatewayAsyncJobResponse>(
    input.providerKey,
    `/v1/providers/${slug}/jobs/execute`,
    {
      kind: input.kind,
      model: input.model,
      prompt: input.prompt,
      jobId: input.jobId,
      userId: input.userId,
      chatId: input.chatId,
      metadata: input.metadata,
    },
  );

  if (!data.resultPayload) {
    throw createProviderEmptyResponseError({
      key: input.providerKey,
      label: providerLabel(input.providerKey),
    });
  }

  return {
    resultPayload: data.resultPayload,
    artifacts: mapArtifacts(data.artifacts),
    usage: mapUsage(data.usage),
    upstreamRequestId: data.upstreamRequestId ?? null,
    externalJobId: data.externalJobId ?? null,
  };
}
