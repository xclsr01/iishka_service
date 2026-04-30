import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderKey } from '@prisma/client';
import { env } from '../../env';
import {
  assertDirectProviderEgressAllowed,
  isAiGatewayConfigured,
  logGatewayProviderTransport,
} from './gateway-client';
import { ProviderAdapterError } from './provider-types';

const originalAppEnv = env.APP_ENV;
const originalAiGatewayUrl = env.AI_GATEWAY_URL;
const originalAiGatewayToken = env.AI_GATEWAY_INTERNAL_TOKEN;
const originalAllowDirectProviderEgress = env.ALLOW_DIRECT_PROVIDER_EGRESS;

afterEach(() => {
  env.APP_ENV = originalAppEnv;
  env.AI_GATEWAY_URL = originalAiGatewayUrl;
  env.AI_GATEWAY_INTERNAL_TOKEN = originalAiGatewayToken;
  env.ALLOW_DIRECT_PROVIDER_EGRESS = originalAllowDirectProviderEgress;
});

test('isAiGatewayConfigured requires both gateway URL and internal token', () => {
  env.AI_GATEWAY_URL = 'https://ai-gateway.example.run.app';
  env.AI_GATEWAY_INTERNAL_TOKEN = undefined;

  assert.equal(isAiGatewayConfigured(), false);

  env.AI_GATEWAY_INTERNAL_TOKEN = 'test-ai-gateway-token-000000000000000000';

  assert.equal(isAiGatewayConfigured(), true);
});

test('assertDirectProviderEgressAllowed blocks direct provider calls unless explicitly enabled outside production', () => {
  env.APP_ENV = 'development';
  env.ALLOW_DIRECT_PROVIDER_EGRESS = false;

  assert.throws(
    () => assertDirectProviderEgressAllowed(ProviderKey.GEMINI, 'chat'),
    (error) => {
      assert.ok(error instanceof ProviderAdapterError);
      assert.equal(error.code, 'PROVIDER_DIRECT_EGRESS_DISABLED');
      return true;
    },
  );

  env.ALLOW_DIRECT_PROVIDER_EGRESS = true;

  assert.doesNotThrow(() =>
    assertDirectProviderEgressAllowed(ProviderKey.GEMINI, 'chat'),
  );
});

test('assertDirectProviderEgressAllowed blocks direct provider calls in production even if flag is set', () => {
  env.APP_ENV = 'production';
  env.ALLOW_DIRECT_PROVIDER_EGRESS = true;

  assert.throws(
    () => assertDirectProviderEgressAllowed(ProviderKey.VEO, 'async_job'),
    (error) => {
      assert.ok(error instanceof ProviderAdapterError);
      assert.equal(error.code, 'PROVIDER_DIRECT_EGRESS_DISABLED');
      return true;
    },
  );
});

test('provider transport selection logs gateway and direct modes without secrets', () => {
  const capturedLogs: string[] = [];
  const originalConsoleInfo = console.info;
  console.info = (value?: unknown) => {
    capturedLogs.push(String(value));
  };

  try {
    env.APP_ENV = 'development';
    env.ALLOW_DIRECT_PROVIDER_EGRESS = true;

    logGatewayProviderTransport(ProviderKey.OPENAI, 'chat');
    assertDirectProviderEgressAllowed(ProviderKey.OPENAI, 'chat');

    const logText = capturedLogs.join('\n');
    assert.match(logText, /"transportMode":"ai_gateway"/);
    assert.match(logText, /"transportMode":"direct_provider"/);
    assert.doesNotMatch(logText, /AI_GATEWAY_INTERNAL_TOKEN/);
    assert.doesNotMatch(logText, /OPENAI_API_KEY/);
  } finally {
    console.info = originalConsoleInfo;
  }
});
