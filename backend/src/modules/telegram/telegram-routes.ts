import { Hono } from 'hono';
import { AppError } from '../../lib/errors';
import { env } from '../../env';
import { logger } from '../../lib/logger';
import { sha256Hex } from '../../lib/crypto';
import { handleTelegramWebhook } from './telegram-service';

export const telegramRoutes = new Hono();

telegramRoutes.get('/status', (c) => {
  return c.json({
    ok: true,
    deliveryMode: env.TELEGRAM_DELIVERY_MODE,
    botUsername: env.TELEGRAM_BOT_USERNAME,
    expectedWebhookUrl: `${env.API_BASE_URL.replace(/\/+$/, '')}/api/telegram/webhook`,
    miniAppUrlConfigured: env.TELEGRAM_MINI_APP_URL.startsWith('https://'),
    webhookSecretConfigured: Boolean(env.TELEGRAM_WEBHOOK_SECRET),
    webhookSecretLength: env.TELEGRAM_WEBHOOK_SECRET.length,
    webhookSecretFingerprint: sha256Hex(env.TELEGRAM_WEBHOOK_SECRET).slice(0, 12),
  });
});

telegramRoutes.post('/webhook', async (c) => {
  const secret = c.req.header('x-telegram-bot-api-secret-token');
  if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    logger.error('telegram_webhook_rejected', {
      reason: 'invalid_secret',
      hasSecretHeader: Boolean(secret),
    });
    throw new AppError('Invalid webhook secret', 401, 'UNAUTHORIZED');
  }

  const update = await c.req.json();
  logger.info('telegram_webhook_received', {
    hasMessage: Boolean(update?.message),
    messageText: typeof update?.message?.text === 'string' ? update.message.text.slice(0, 32) : null,
  });
  await handleTelegramWebhook(update);
  logger.info('telegram_webhook_handled');
  return c.json({ ok: true });
});
