import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { env } from './env';
import { notFoundHandler } from './middleware/error-handler';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { requestIdMiddleware } from './middleware/request-id';
import { toAppError } from './lib/errors';
import { jsonSafeError } from './lib/http';
import { logger } from './lib/logger';
import { ProviderAdapterError } from './modules/providers/provider-types';
import { authRoutes } from './modules/auth/auth-routes';
import { catalogRoutes } from './modules/catalog/catalog-routes';
import { chatRoutes } from './modules/chats/chat-routes';
import { fileRoutes } from './modules/files/file-routes';
import { jobsRoutes } from './modules/jobs/jobs-routes';
import { subscriptionRoutes } from './modules/subscriptions/subscription-routes';
import { telegramRoutes } from './modules/telegram/telegram-routes';
import { userRoutes } from './modules/users/user-routes';
import type { AppVariables } from './types';

export function createApp() {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use(
    '*',
    cors({
      origin: env.FRONTEND_URL,
      allowHeaders: ['content-type', 'authorization', 'x-request-id'],
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      credentials: false,
    }),
  );
  app.use('*', requestIdMiddleware);
  app.use('*', rateLimitMiddleware);

  app.get('/', (c) => {
    return c.json({
      ok: true,
      service: 'iishka-backend',
      env: env.APP_ENV,
      healthUrl: '/health',
    });
  });

  app.get('/health', (c) => {
    return c.json({
      ok: true,
      env: env.APP_ENV,
    });
  });

  app.route('/api/auth', authRoutes);
  app.route('/api/me', userRoutes);
  app.route('/api/catalog', catalogRoutes);
  app.route('/api/chats', chatRoutes);
  app.route('/api/files', fileRoutes);
  app.route('/api/jobs', jobsRoutes);
  app.route('/api/subscription', subscriptionRoutes);
  app.route('/api/telegram', telegramRoutes);

  app.onError((error, c) => {
    const appError = toAppError(error);
    logger.error('request_failed', {
      method: c.req.method,
      path: c.req.path,
      statusCode: appError.statusCode,
      code: appError.code,
      providerKey: error instanceof ProviderAdapterError ? error.providerKey : null,
      providerCategory: error instanceof ProviderAdapterError ? error.category : null,
      providerRetryable: error instanceof ProviderAdapterError ? error.retryable : null,
      upstreamStatus: error instanceof ProviderAdapterError ? error.upstreamStatus ?? null : null,
      upstreamRequestId: error instanceof ProviderAdapterError ? error.upstreamRequestId ?? null : null,
      message: error instanceof Error ? error.message : 'unknown',
      details: appError.details ?? null,
      stack: error instanceof Error ? error.stack ?? null : null,
    });
    return c.json(jsonSafeError(appError), {
      status: appError.statusCode as ContentfulStatusCode,
    });
  });

  app.notFound(notFoundHandler);

  return app;
}
