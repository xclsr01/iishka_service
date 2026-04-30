import type { ProviderKey } from '@prisma/client';
import { ProviderAdapterError } from './provider-types';

export const DEFAULT_PROVIDER_TIMEOUT_MS = 15000;

type ProviderDescriptor = {
  key: ProviderKey;
  label: string;
};

type UpstreamHttpErrorInput = ProviderDescriptor & {
  status: number;
  upstreamRequestId?: string | null;
  rawBody?: string;
};

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

function buildSafeProviderDetails(input: UpstreamHttpErrorInput) {
  const providerErrorCode = extractProviderErrorCode(input.rawBody);
  if (!providerErrorCode) {
    return undefined;
  }

  return {
    providerErrorCode,
  };
}

export function providerErrorLogMeta(error: ProviderAdapterError) {
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
    providerKey: error.providerKey,
    errorCode: error.code,
    errorCategory: error.category,
    providerErrorCode,
    retryable: error.retryable,
    upstreamStatus: error.upstreamStatus ?? null,
    upstreamRequestId: error.upstreamRequestId ?? null,
  };
}

export function isProviderTimeoutError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

export function isRetryableProviderStatus(status: number) {
  return (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

export function mapProviderHttpCategory(status: number) {
  if (status === 429) {
    return 'rate_limit' as const;
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

export function createProviderTimeoutError(input: ProviderDescriptor) {
  return new ProviderAdapterError({
    providerKey: input.key,
    message: `${input.label} request timed out`,
    code: 'PROVIDER_TIMEOUT',
    category: 'timeout',
    retryable: true,
    statusCode: 504,
  });
}

export function createProviderNetworkError(
  input: ProviderDescriptor & { error?: Error },
) {
  return new ProviderAdapterError({
    providerKey: input.key,
    message: `${input.label} network request failed`,
    code: 'PROVIDER_NETWORK_ERROR',
    category: 'network',
    retryable: true,
    statusCode: 502,
    details: input.error?.message.trim()
      ? {
          providerErrorCode: 'NETWORK_ERROR',
        }
      : undefined,
  });
}

export function createProviderEmptyResponseError(input: ProviderDescriptor) {
  return new ProviderAdapterError({
    providerKey: input.key,
    message: `${input.label} returned empty content`,
    code: 'PROVIDER_EMPTY_RESPONSE',
    category: 'empty_response',
    retryable: false,
    statusCode: 502,
  });
}

export function createProviderRegionUnavailableError(
  input: ProviderDescriptor & {
    clientMessage: string;
    upstreamRequestId?: string | null;
  },
) {
  return new ProviderAdapterError({
    providerKey: input.key,
    message: input.clientMessage,
    code: 'PROVIDER_REGION_UNAVAILABLE',
    category: 'region_unavailable',
    retryable: false,
    statusCode: 503,
    upstreamRequestId: input.upstreamRequestId ?? null,
  });
}

export function createUpstreamHttpError(input: UpstreamHttpErrorInput) {
  return new ProviderAdapterError({
    providerKey: input.key,
    message: `${input.label} upstream request failed`,
    code:
      input.status === 429
        ? 'PROVIDER_RATE_LIMITED'
        : 'PROVIDER_REQUEST_FAILED',
    category: mapProviderHttpCategory(input.status),
    retryable: isRetryableProviderStatus(input.status),
    statusCode: 502,
    upstreamStatus: input.status,
    upstreamRequestId: input.upstreamRequestId ?? null,
    details: buildSafeProviderDetails(input),
  });
}

export function toClientSafeProviderMessage(error: ProviderAdapterError) {
  if (error.code === 'PROVIDER_REGION_UNAVAILABLE') {
    return error.message;
  }

  if (error.code === 'PROVIDER_RATE_LIMITED') {
    return 'The provider is currently busy. Please retry.';
  }

  if (error.code === 'PROVIDER_TIMEOUT') {
    return 'The provider request timed out. Please retry.';
  }

  return 'The provider request failed. Please retry.';
}
