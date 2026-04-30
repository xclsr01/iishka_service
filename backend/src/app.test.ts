import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderKey } from '@prisma/client';
import { createApp } from './app';
import { env } from './env';
import { createUpstreamHttpError } from './modules/providers/provider-error-mapping';

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
  assert.equal(
    response.headers.get('access-control-allow-origin'),
    env.FRONTEND_URL,
  );
  assert.match(
    response.headers.get('access-control-allow-methods') ?? '',
    /\bDELETE\b/,
  );
});

test('provider upstream error body is redacted from backend response and logs', async () => {
  const promptLikeText = 'SECRET_PROMPT_DO_NOT_LOG';
  const capturedLogs: string[] = [];
  const originalConsoleError = console.error;
  console.error = (value?: unknown) => {
    capturedLogs.push(String(value));
  };

  try {
    const app = createApp();
    app.get('/test-provider-redaction', () => {
      throw createUpstreamHttpError({
        key: ProviderKey.OPENAI,
        label: 'OpenAI',
        status: 400,
        upstreamRequestId: 'upstream_req_redacted',
        rawBody: JSON.stringify({
          error: {
            code: 'content_policy',
            message: `Provider rejected prompt: ${promptLikeText}`,
          },
        }),
      });
    });

    const response = await app.request('/test-provider-redaction');
    const responseText = await response.text();
    const logText = capturedLogs.join('\n');

    assert.equal(response.status, 502);
    assert.doesNotMatch(responseText, new RegExp(promptLikeText));
    assert.doesNotMatch(logText, new RegExp(promptLikeText));
    assert.match(logText, /content_policy/);
    assert.match(logText, /upstream_req_redacted/);
  } finally {
    console.error = originalConsoleError;
  }
});
