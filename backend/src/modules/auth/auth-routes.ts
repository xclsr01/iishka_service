import { Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { createRateLimitMiddleware } from '../../middleware/rate-limit';
import { bootstrapDevUser, bootstrapTelegramUser } from './auth-service';

const telegramBootstrapSchema = z.object({
  initDataRaw: z.string().min(1),
});

const devBootstrapSchema = z.object({
  sharedSecret: z.string().min(1),
});

export const authRoutes = new Hono();

const authBootstrapRateLimit = createRateLimitMiddleware('auth_bootstrap');

authRoutes.use('/telegram/bootstrap', authBootstrapRateLimit);
authRoutes.use('/dev/bootstrap', authBootstrapRateLimit);

authRoutes.post('/telegram/bootstrap', async (c) => {
  const payload = telegramBootstrapSchema.parse(await c.req.json());
  const result = await bootstrapTelegramUser(payload.initDataRaw);
  return c.json(result);
});

authRoutes.post('/dev/bootstrap', async (c) => {
  const payload = devBootstrapSchema.parse(await c.req.json());

  try {
    const result = await bootstrapDevUser(payload.sharedSecret);
    return c.json(result);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      'Invalid dev bootstrap credentials',
      401,
      'UNAUTHORIZED',
    );
  }
});
