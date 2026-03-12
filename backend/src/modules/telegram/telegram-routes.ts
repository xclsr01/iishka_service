import { Hono } from 'hono';
import { AppError } from '../../lib/errors';
import { env } from '../../env';
import { handleTelegramWebhook } from './telegram-service';

export const telegramRoutes = new Hono();

telegramRoutes.post('/webhook', async (c) => {
  const secret = c.req.header('x-telegram-bot-api-secret-token');
  if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    throw new AppError('Invalid webhook secret', 401, 'UNAUTHORIZED');
  }

  const update = await c.req.json();
  await handleTelegramWebhook(update);
  return c.json({ ok: true });
});
