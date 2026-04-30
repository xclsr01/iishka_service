import type { Context, Next } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { AppError, toAppError } from '../lib/errors';
import { jsonSafeError } from '../lib/http';
import { logger } from '../lib/logger';
import { providerErrorLogMeta } from '../modules/providers/provider-error-mapping';
import { ProviderAdapterError } from '../modules/providers/provider-types';

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (error) {
    const appError = toAppError(error);
    const providerMeta =
      error instanceof ProviderAdapterError
        ? providerErrorLogMeta(error)
        : null;
    logger.error('request_failed', {
      path: c.req.path,
      code: appError.code,
      providerKey: providerMeta?.providerKey ?? null,
      providerCategory: providerMeta?.errorCategory ?? null,
      providerErrorCode: providerMeta?.providerErrorCode ?? null,
      providerRetryable: providerMeta?.retryable ?? null,
      upstreamStatus: providerMeta?.upstreamStatus ?? null,
      upstreamRequestId: providerMeta?.upstreamRequestId ?? null,
      errorMessage:
        error instanceof ProviderAdapterError
          ? 'Provider request failed'
          : error instanceof Error
            ? error.message
            : 'unknown',
    });
    return c.json(jsonSafeError(appError), {
      status: appError.statusCode as ContentfulStatusCode,
    });
  }
}

export function notFoundHandler(c: Context) {
  const error = new AppError('Route not found', 404, 'NOT_FOUND');
  return c.json(jsonSafeError(error), {
    status: 404,
  });
}
