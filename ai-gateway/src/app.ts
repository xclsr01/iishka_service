import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { toAppError } from './lib/errors';
import { withRequestId, type GatewayVariables } from './lib/http';
import { logger } from './lib/logger';
import { healthRoutes } from './routes/health-routes';
import { providerRoutes } from './routes/provider-routes';
import { requestIdMiddleware } from './middleware/request-id';

export function createApp() {
  const app = new Hono<{ Variables: GatewayVariables }>();

  app.use('*', requestIdMiddleware);

  app.route('/', healthRoutes);
  app.route('/v1', providerRoutes);

  app.notFound((c) => {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Route not found',
          requestId: c.get('requestId'),
        },
      },
      404,
    );
  });

  app.onError((error, c) => {
    const appError = toAppError(error);
    logger.error('request_failed', {
      route: c.req.path,
      method: c.req.method,
      code: appError.code,
      statusCode: appError.statusCode,
      upstreamStatus: appError.upstreamStatus ?? null,
      upstreamRequestId: appError.upstreamRequestId ?? null,
      details: appError.details ?? null,
      message: appError.message,
      stack: error instanceof Error ? error.stack ?? null : null,
    });

    return c.json(withRequestId(appError, c.get('requestId')), {
      status: appError.statusCode as ContentfulStatusCode,
    });
  });

  return app;
}
