import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app';

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
