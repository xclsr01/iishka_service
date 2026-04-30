import { AppError } from '../../lib/errors';
import type { GatewayProviderKey } from './gateway-types';

type ProviderErrorInput = {
  provider: GatewayProviderKey;
  status: number;
  upstreamRequestId?: string | null;
  rawBody?: string;
};

function providerLabel(provider: GatewayProviderKey) {
  switch (provider) {
    case 'openai':
      return 'OpenAI';
    case 'anthropic':
      return 'Anthropic';
    case 'gemini':
      return 'Gemini';
    case 'nano-banana':
      return 'Nano Banana';
    case 'veo':
      return 'Veo';
    default:
      return 'Provider';
  }
}

function extractProviderErrorCode(rawBody?: string) {
  if (!rawBody) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const payload = parsed as Record<string, unknown>;
  const error = payload.error;
  if (error && typeof error === 'object') {
    const errorPayload = error as Record<string, unknown>;
    const code = errorPayload.code ?? errorPayload.type;
    return typeof code === 'string' && code.trim()
      ? code.trim().slice(0, 120)
      : null;
  }

  const code = payload.code ?? payload.type;
  return typeof code === 'string' && code.trim()
    ? code.trim().slice(0, 120)
    : null;
}

function buildSafeProviderDetails(input: ProviderErrorInput) {
  const providerErrorCode = extractProviderErrorCode(input.rawBody);
  if (!providerErrorCode) {
    return undefined;
  }

  return {
    providerErrorCode,
  };
}

export function gatewayProviderErrorLogMeta(error: AppError) {
  const details =
    error.details &&
    typeof error.details === 'object' &&
    !Array.isArray(error.details)
      ? (error.details as Record<string, unknown>)
      : {};
  const providerErrorCode =
    typeof details.providerErrorCode === 'string'
      ? details.providerErrorCode
      : null;

  return {
    errorCode: error.code,
    providerErrorCode,
    retryable: error.retryable ?? null,
    upstreamStatus: error.upstreamStatus ?? null,
    upstreamRequestId: error.upstreamRequestId ?? null,
  };
}

export function isRetryableUpstreamStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

export function isRetryableGatewayError(error: unknown) {
  return error instanceof AppError && error.retryable === true;
}

export function createTimeoutError(provider: GatewayProviderKey) {
  return new AppError({
    message: `${providerLabel(provider)} request timed out`,
    statusCode: 504,
    code: 'PROVIDER_TIMEOUT',
    retryable: true,
  });
}

export function createNetworkError(
  provider: GatewayProviderKey,
  error?: Error,
) {
  return new AppError({
    message: `${providerLabel(provider)} network request failed`,
    statusCode: 502,
    code: 'PROVIDER_UNAVAILABLE',
    retryable: true,
    details: error?.message.trim()
      ? {
          providerErrorCode: 'NETWORK_ERROR',
        }
      : undefined,
  });
}

export function createEmptyResponseError(provider: GatewayProviderKey) {
  return new AppError({
    message: `${providerLabel(provider)} returned empty content`,
    statusCode: 502,
    code: 'PROVIDER_EMPTY_RESPONSE',
    retryable: false,
  });
}

export function createUnsupportedOperationError(
  provider: GatewayProviderKey,
  operation: string,
) {
  return new AppError({
    message: `${providerLabel(provider)} does not support ${operation}`,
    statusCode: 400,
    code: 'GATEWAY_BAD_REQUEST',
    retryable: false,
  });
}

export function createUpstreamHttpError(input: ProviderErrorInput) {
  const base = {
    upstreamStatus: input.status,
    upstreamRequestId: input.upstreamRequestId ?? null,
    details: buildSafeProviderDetails(input),
  };

  if (input.status === 429) {
    return new AppError({
      ...base,
      message: `${providerLabel(input.provider)} is currently rate limited`,
      statusCode: 503,
      code: 'PROVIDER_RATE_LIMITED',
      retryable: true,
    });
  }

  if (input.status === 401 || input.status === 403) {
    return new AppError({
      ...base,
      message: `${providerLabel(input.provider)} authorization failed`,
      statusCode: 502,
      code: 'PROVIDER_UNAVAILABLE',
      retryable: false,
    });
  }

  if (input.status >= 400 && input.status < 500) {
    return new AppError({
      ...base,
      message: `${providerLabel(input.provider)} rejected the request`,
      statusCode: 502,
      code: 'PROVIDER_BAD_REQUEST',
      retryable: false,
    });
  }

  return new AppError({
    ...base,
    message: `${providerLabel(input.provider)} is unavailable`,
    statusCode: 503,
    code: 'PROVIDER_UNAVAILABLE',
    retryable: isRetryableUpstreamStatus(input.status),
  });
}
