import type { Context, Next } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { AppError, toAppError } from '../lib/errors';
import { jsonSafeError } from '../lib/http';
import { logger } from '../lib/logger';

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (error) {
    const appError = toAppError(error);
    logger.error('request_failed', {
      path: c.req.path,
      code: appError.code,
      message: error instanceof Error ? error.message : 'unknown',
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
