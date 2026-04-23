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

function sanitizeUpstreamBody(rawBody?: string) {
  const trimmed = rawBody?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, 1200);
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

export function createNetworkError(provider: GatewayProviderKey, error?: Error) {
  return new AppError({
    message: `${providerLabel(provider)} network request failed`,
    statusCode: 502,
    code: 'PROVIDER_UNAVAILABLE',
    retryable: true,
    details: error
      ? {
          upstreamMessage: error.message,
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

export function createUnsupportedOperationError(provider: GatewayProviderKey, operation: string) {
  return new AppError({
    message: `${providerLabel(provider)} does not support ${operation}`,
    statusCode: 400,
    code: 'GATEWAY_BAD_REQUEST',
    retryable: false,
  });
}

export function createUpstreamHttpError(input: ProviderErrorInput) {
  const sanitizedBody = sanitizeUpstreamBody(input.rawBody);
  const base = {
    upstreamStatus: input.status,
    upstreamRequestId: input.upstreamRequestId ?? null,
    details: sanitizedBody
      ? {
          upstreamBody: sanitizedBody,
        }
      : undefined,
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
