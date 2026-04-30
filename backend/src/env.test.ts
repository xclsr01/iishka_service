import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBackendEnv } from './env';

const validProductionEnv = {
  APP_ENV: 'production',
  FRONTEND_URL: 'https://iishka-service.pages.dev',
  API_BASE_URL: 'https://api.example.com',
  DATABASE_URL:
    'postgresql://prod-user:prod-password@db.example.com:5432/iishka',
  JWT_SECRET: 'prod-jwt-secret-prod-jwt-secret-000000000000',
  TELEGRAM_BOT_TOKEN: '123456789:prod-telegram-bot-token',
  TELEGRAM_WEBHOOK_SECRET: 'prod-telegram-webhook-secret',
  TELEGRAM_MINI_APP_URL: 'https://iishka-service.pages.dev',
  TELEGRAM_DELIVERY_MODE: 'webhook',
  AI_GATEWAY_URL: 'https://ai-gateway.example.run.app',
  AI_GATEWAY_INTERNAL_TOKEN: 'prod-ai-gateway-token-000000000000000000',
  RATE_LIMIT_DRIVER: 'upstash',
  UPSTASH_REDIS_REST_URL: 'https://upstash.example.com',
  UPSTASH_REDIS_REST_TOKEN: 'prod-upstash-token-000000000000000000',
  JOB_QUEUE_DRIVER: 'db',
};

test('parseBackendEnv rejects production placeholders and missing AI gateway config', () => {
  assert.throws(
    () =>
      parseBackendEnv({
        APP_ENV: 'production',
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /JWT_SECRET/);
      assert.match(error.message, /TELEGRAM_BOT_TOKEN/);
      assert.match(error.message, /TELEGRAM_WEBHOOK_SECRET/);
      assert.match(error.message, /DATABASE_URL/);
      assert.match(error.message, /AI_GATEWAY_URL/);
      assert.match(error.message, /AI_GATEWAY_INTERNAL_TOKEN/);
      assert.match(error.message, /RATE_LIMIT_DRIVER/);
      assert.match(error.message, /JOB_QUEUE_DRIVER/);
      return true;
    },
  );
});

test('parseBackendEnv accepts production with required AI gateway config', () => {
  const env = parseBackendEnv(validProductionEnv);

  assert.equal(env.APP_ENV, 'production');
  assert.equal(env.AI_GATEWAY_URL, validProductionEnv.AI_GATEWAY_URL);
  assert.equal(
    env.AI_GATEWAY_INTERNAL_TOKEN,
    validProductionEnv.AI_GATEWAY_INTERNAL_TOKEN,
  );
});

test('parseBackendEnv rejects direct provider egress in production', () => {
  assert.throws(
    () =>
      parseBackendEnv({
        ...validProductionEnv,
        ALLOW_DIRECT_PROVIDER_EGRESS: 'true',
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /ALLOW_DIRECT_PROVIDER_EGRESS/);
      return true;
    },
  );
});

test('parseBackendEnv rejects memory rate limiter in production', () => {
  assert.throws(
    () =>
      parseBackendEnv({
        ...validProductionEnv,
        RATE_LIMIT_DRIVER: 'memory',
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /RATE_LIMIT_DRIVER=memory/);
      return true;
    },
  );
});

test('parseBackendEnv rejects inline job queue in production', () => {
  assert.throws(
    () =>
      parseBackendEnv({
        ...validProductionEnv,
        JOB_QUEUE_DRIVER: 'inline',
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /JOB_QUEUE_DRIVER=inline/);
      return true;
    },
  );
});

test('parseBackendEnv requires Upstash config when Upstash limiter is selected', () => {
  assert.throws(
    () =>
      parseBackendEnv({
        APP_ENV: 'development',
        RATE_LIMIT_DRIVER: 'upstash',
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /UPSTASH_REDIS_REST_URL/);
      assert.match(error.message, /UPSTASH_REDIS_REST_TOKEN/);
      return true;
    },
  );
});

test('parseBackendEnv still requires AI gateway even with legacy emergency env present', () => {
  assert.throws(
    () =>
      parseBackendEnv({
        ...validProductionEnv,
        AI_GATEWAY_URL: '',
        AI_GATEWAY_INTERNAL_TOKEN: '',
        EMERGENCY_ALLOW_DIRECT_PROVIDER_EGRESS_IN_PRODUCTION: 'true',
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /AI_GATEWAY_URL/);
      assert.match(error.message, /AI_GATEWAY_INTERNAL_TOKEN/);
      return true;
    },
  );
});

test('parseBackendEnv allows direct provider egress flag outside production', () => {
  const env = parseBackendEnv({
    ...validProductionEnv,
    APP_ENV: 'development',
    AI_GATEWAY_URL: '',
    AI_GATEWAY_INTERNAL_TOKEN: '',
    ALLOW_DIRECT_PROVIDER_EGRESS: 'true',
  });

  assert.equal(env.APP_ENV, 'development');
  assert.equal(env.AI_GATEWAY_URL, undefined);
  assert.equal(env.AI_GATEWAY_INTERNAL_TOKEN, undefined);
  assert.equal(env.ALLOW_DIRECT_PROVIDER_EGRESS, true);
});

test('parseBackendEnv keeps development defaults permissive', () => {
  const env = parseBackendEnv({
    APP_ENV: 'development',
  });

  assert.equal(env.APP_ENV, 'development');
  assert.equal(
    env.DATABASE_URL,
    'postgresql://user:password@localhost:5432/iishka_service',
  );
  assert.equal(env.AI_GATEWAY_URL, undefined);
});
