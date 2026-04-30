import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AI_GATEWAY_INTERNAL_TOKEN ??=
  'test-ai-gateway-token-000000000000000000';
process.env.OPENAI_API_KEY ??= 'test-openai-key';
process.env.ANTHROPIC_API_KEY ??= 'test-anthropic-key';
process.env.GOOGLE_AI_API_KEY ??= 'test-google-key';

const { parseGatewayEnv } = await import('./env');

const validProductionEnv = {
  APP_ENV: 'production',
  AI_GATEWAY_INTERNAL_TOKEN: 'prod-ai-gateway-token-000000000000000000',
  OPENAI_API_KEY: 'sk-prod-openai-key',
  ANTHROPIC_API_KEY: 'sk-prod-anthropic-key',
  GOOGLE_AI_API_KEY: 'prod-google-ai-key',
};

test('parseGatewayEnv rejects production placeholder provider secrets', () => {
  assert.throws(
    () =>
      parseGatewayEnv({
        APP_ENV: 'production',
        AI_GATEWAY_INTERNAL_TOKEN:
          'replace-this-placeholder-secret-before-production-use-0000000000000000',
        OPENAI_API_KEY: 'replace-me',
        ANTHROPIC_API_KEY: 'replace-me',
        GOOGLE_AI_API_KEY: 'replace-me',
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /AI_GATEWAY_INTERNAL_TOKEN/);
      assert.match(error.message, /OPENAI_API_KEY/);
      assert.match(error.message, /ANTHROPIC_API_KEY/);
      assert.match(error.message, /GOOGLE_AI_API_KEY/);
      return true;
    },
  );
});

test('parseGatewayEnv accepts production provider secrets', () => {
  const env = parseGatewayEnv(validProductionEnv);

  assert.equal(env.APP_ENV, 'production');
  assert.equal(
    env.AI_GATEWAY_INTERNAL_TOKEN,
    validProductionEnv.AI_GATEWAY_INTERNAL_TOKEN,
  );
  assert.equal(env.OPENAI_API_KEY, validProductionEnv.OPENAI_API_KEY);
});
