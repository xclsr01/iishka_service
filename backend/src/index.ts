import './load-local-env';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { env } from './env';
import { logger } from './lib/logger';
import { configureDefaultMiniAppMenuButton } from './modules/telegram/telegram-service';
import { startTelegramPolling } from './modules/telegram/telegram-poller';

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
  startTelegramPolling();
}

if (env.TELEGRAM_DELIVERY_MODE !== 'disabled') {
  void configureDefaultMiniAppMenuButton();
}
