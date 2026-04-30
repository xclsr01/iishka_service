import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { env } from '../env';
import { jsonSafeError } from '../lib/http';
import { toAppError } from '../lib/errors';
import { createRateLimitMiddleware, MemoryRateLimiter } from './rate-limit';
import type { AppVariables } from '../types';

function createTestApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.onError((error, c) => {
    const appError = toAppError(error);
    return c.json(jsonSafeError(appError), appError.statusCode);
  });
  return app;
}

test('anonymous rate limit uses trusted client IP header and ignores x-forwarded-for', async () => {
  const limiter = new MemoryRateLimiter();
  const app = createTestApp();
  const originalTrustHeaders = env.TRUST_PLATFORM_CLIENT_IP_HEADERS;
  env.TRUST_PLATFORM_CLIENT_IP_HEADERS = true;

  app.post(
    '/bootstrap',
    createRateLimitMiddleware('auth_bootstrap', {
      limiter,
      policies: {
        auth_bootstrap: {
          name: 'auth_bootstrap',
          identity: 'anonymous',
          limit: 1,
          windowSeconds: 60,
        },
      },
    }),
    (c) => c.json({ ok: true }),
  );

  try {
    const first = await app.request('/bootstrap', {
      method: 'POST',
      headers: {
        'x-forwarded-for': '1.1.1.1',
        'cf-connecting-ip': '203.0.113.10',
      },
    });
    const second = await app.request('/bootstrap', {
      method: 'POST',
      headers: {
        'x-forwarded-for': '2.2.2.2',
        'cf-connecting-ip': '203.0.113.10',
      },
    });

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
  } finally {
    env.TRUST_PLATFORM_CLIENT_IP_HEADERS = originalTrustHeaders;
  }
});

test('authenticated rate limit uses user id instead of authorization token', async () => {
  const limiter = new MemoryRateLimiter();
  const app = createTestApp();

  app.use('/messages', async (c, next) => {
    c.set('authSession', {
      userId: 'user_1',
      telegramUserId: 'telegram_1',
      username: null,
    });
    await next();
  });
  app.post(
    '/messages',
    createRateLimitMiddleware('message_create', {
      limiter,
      policies: {
        message_create: {
          name: 'message_create',
          identity: 'user',
          limit: 1,
          windowSeconds: 60,
        },
      },
    }),
    (c) => c.json({ ok: true }),
  );

  const first = await app.request('/messages', {
    method: 'POST',
    headers: {
      authorization: 'Bearer token-one',
    },
  });
  const second = await app.request('/messages', {
    method: 'POST',
    headers: {
      authorization: 'Bearer token-two',
    },
  });

  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
});
