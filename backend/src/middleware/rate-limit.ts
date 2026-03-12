import type { Context, Next } from 'hono';
import { env } from '../env';
import { AppError } from '../lib/errors';

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export async function rateLimitMiddleware(c: Context, next: Next) {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const auth = c.req.header('authorization') ?? 'anonymous';
  const key = `${ip}:${auth}`;
  const now = Date.now();
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, {
      count: 1,
      resetAt: now + env.RATE_LIMIT_WINDOW_SECONDS * 1000,
    });
    await next();
    return;
  }

  if (current.count >= env.RATE_LIMIT_MAX_REQUESTS) {
    throw new AppError('Rate limit exceeded', 429, 'RATE_LIMITED');
  }

  current.count += 1;
  await next();
}
