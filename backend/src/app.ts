import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from './env';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { requestIdMiddleware } from './middleware/request-id';
import { authRoutes } from './modules/auth/auth-routes';
import { catalogRoutes } from './modules/catalog/catalog-routes';
import { chatRoutes } from './modules/chats/chat-routes';
import { fileRoutes } from './modules/files/file-routes';
import { subscriptionRoutes } from './modules/subscriptions/subscription-routes';
import { telegramRoutes } from './modules/telegram/telegram-routes';
import { userRoutes } from './modules/users/user-routes';
import type { AppVariables } from './types';

export function createApp() {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use('*', errorHandler);
  app.use(
    '*',
    cors({
      origin: env.FRONTEND_URL,
      allowHeaders: ['content-type', 'authorization', 'x-request-id'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      credentials: false,
    }),
  );
  app.use('*', requestIdMiddleware);
  app.use('*', rateLimitMiddleware);

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
  app.route('/api/subscription', subscriptionRoutes);
  app.route('/api/telegram', telegramRoutes);

  app.notFound(notFoundHandler);

  return app;
}
