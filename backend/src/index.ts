import './load-local-env';
import { logger } from './lib/logger';

process.on('uncaughtException', (error) => {
  logger.error('process_uncaught_exception', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? (error.stack ?? null) : null,
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error('process_unhandled_rejection', {
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? (reason.stack ?? null) : null,
  });
});

async function main() {
  const [{ serve }, { createApp }, { env }, telegramService, telegramPoller] =
    await Promise.all([
      import('@hono/node-server'),
      import('./app'),
      import('./env'),
      import('./modules/telegram/telegram-service'),
      import('./modules/telegram/telegram-poller'),
    ]);

  logger.info('server_starting', {
    appEnv: env.APP_ENV,
    port: env.PORT,
    deliveryMode: env.TELEGRAM_DELIVERY_MODE,
    rateLimitDriver: env.RATE_LIMIT_DRIVER,
    uploadStorageDriver: env.UPLOAD_STORAGE_DRIVER,
    hasFrontendUrl: Boolean(env.FRONTEND_URL),
    hasApiBaseUrl: Boolean(env.API_BASE_URL),
    hasAiGatewayUrl: Boolean(env.AI_GATEWAY_URL),
    hasSupabaseUrl: Boolean(env.SUPABASE_URL),
    hasSupabaseStorageBucket: Boolean(env.SUPABASE_STORAGE_BUCKET),
    hasUpstashRedisRestUrl: Boolean(env.UPSTASH_REDIS_REST_URL),
  });

  const app = createApp();

  serve(
    {
      fetch: app.fetch,
      port: env.PORT,
    },
    (info) => {
      logger.info('server_started', { ...info });
    },
  );

  if (env.TELEGRAM_DELIVERY_MODE === 'polling') {
    telegramPoller.startTelegramPolling();
  }

  if (env.TELEGRAM_DELIVERY_MODE !== 'disabled') {
    void telegramService.configureDefaultMiniAppMenuButton();
  }
}

main().catch((error) => {
  logger.error('server_start_failed', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? (error.stack ?? null) : null,
  });
  process.exitCode = 1;
});
