import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app';
import { env } from './env';

test('GET /health returns backend health status', async () => {
  const app = createApp();
  const response = await app.request('/health');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    env: 'test',
  });
});

test('GET /api/subscription without auth returns 401', async () => {
  const app = createApp();
  const response = await app.request('/api/subscription');
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('OPTIONS /api/jobs/:id allows DELETE preflight', async () => {
  const app = createApp();
  const response = await app.request('/api/jobs/test-job-id', {
    method: 'OPTIONS',
    headers: {
      origin: env.FRONTEND_URL,
      'access-control-request-method': 'DELETE',
      'access-control-request-headers': 'authorization',
    },
  });

  assert.ok(response.status === 200 || response.status === 204);
  assert.equal(response.headers.get('access-control-allow-origin'), env.FRONTEND_URL);
  assert.match(response.headers.get('access-control-allow-methods') ?? '', /\bDELETE\b/);
});
