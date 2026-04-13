import { AppError } from '../../lib/errors';

type UpstreamErrorInput = {
  status: number;
  upstreamRequestId?: string | null;
  rawBody?: string;
};

function sanitizeUpstreamBody(rawBody?: string) {
  const trimmed = rawBody?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, 1000);
}

export function isRetryableUpstreamStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

export function isRetryableGatewayError(error: unknown) {
  return error instanceof AppError && error.retryable === true;
}

export function createUnauthorizedError() {
  return new AppError({
    message: 'Unauthorized',
    statusCode: 401,
    code: 'GATEWAY_UNAUTHORIZED',
  });
}

export function createTimeoutError() {
  return new AppError({
    message: 'OpenAI request timed out',
    statusCode: 504,
    code: 'PROVIDER_TIMEOUT',
    retryable: true,
  });
}

export function createNetworkError(error?: Error) {
  return new AppError({
    message: 'OpenAI network request failed',
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

export function createEmptyResponseError() {
  return new AppError({
    message: 'OpenAI returned empty content',
    statusCode: 502,
    code: 'PROVIDER_EMPTY_RESPONSE',
    retryable: false,
  });
}

export function createUpstreamHttpError(input: UpstreamErrorInput) {
  if (input.status === 429) {
    return new AppError({
      message: 'OpenAI is currently rate limited',
      statusCode: 503,
      code: 'PROVIDER_RATE_LIMITED',
      retryable: true,
      upstreamStatus: input.status,
      upstreamRequestId: input.upstreamRequestId ?? null,
      details: sanitizeUpstreamBody(input.rawBody)
        ? {
            upstreamBody: sanitizeUpstreamBody(input.rawBody),
          }
        : undefined,
    });
  }

  if (input.status === 401 || input.status === 403) {
    return new AppError({
      message: 'OpenAI authorization failed',
      statusCode: 502,
      code: 'PROVIDER_UNAVAILABLE',
      retryable: false,
      upstreamStatus: input.status,
      upstreamRequestId: input.upstreamRequestId ?? null,
      details: sanitizeUpstreamBody(input.rawBody)
        ? {
            upstreamBody: sanitizeUpstreamBody(input.rawBody),
          }
        : undefined,
    });
  }

  if (input.status >= 400 && input.status < 500) {
    return new AppError({
      message: 'OpenAI rejected the request',
      statusCode: 502,
      code: 'PROVIDER_BAD_REQUEST',
      retryable: false,
      upstreamStatus: input.status,
      upstreamRequestId: input.upstreamRequestId ?? null,
      details: sanitizeUpstreamBody(input.rawBody)
        ? {
            upstreamBody: sanitizeUpstreamBody(input.rawBody),
          }
        : undefined,
    });
  }

  return new AppError({
    message: 'OpenAI is unavailable',
    statusCode: 503,
    code: 'PROVIDER_UNAVAILABLE',
    retryable: isRetryableUpstreamStatus(input.status),
    upstreamStatus: input.status,
    upstreamRequestId: input.upstreamRequestId ?? null,
    details: sanitizeUpstreamBody(input.rawBody)
      ? {
          upstreamBody: sanitizeUpstreamBody(input.rawBody),
        }
      : undefined,
  });
}
