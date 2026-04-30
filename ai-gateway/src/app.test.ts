import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AI_GATEWAY_INTERNAL_TOKEN ??=
  'test-ai-gateway-token-000000000000000000';
process.env.OPENAI_API_KEY ??= 'test-openai-key';
process.env.ANTHROPIC_API_KEY ??= 'test-anthropic-key';
process.env.GOOGLE_AI_API_KEY ??= 'test-google-key';

const [{ createApp }, { createUpstreamHttpError }] = await Promise.all([
  import('./app'),
  import('./modules/gateway/provider-errors'),
]);

test('provider upstream error body is redacted from gateway response and logs', async () => {
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
        provider: 'openai',
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
