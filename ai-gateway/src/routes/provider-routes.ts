import { Hono } from 'hono';
import type { Context } from 'hono';
import { AppError } from '../lib/errors';
import { parseJsonWithSchema, type GatewayVariables } from '../lib/http';
import { authMiddleware } from '../middleware/auth';
import { respondWithAnthropic } from '../modules/anthropic/anthropic-service';
import { createUnsupportedOperationError } from '../modules/gateway/provider-errors';
import { asyncJobRequestSchema, chatRespondRequestSchema, providerKeySchema } from '../modules/gateway/gateway-validation';
import { executeNanoBananaJob, executeVeoJob, respondWithGemini } from '../modules/google/google-service';
import { respondWithOpenAi } from '../modules/openai/openai-service';

export const providerRoutes = new Hono<{ Variables: GatewayVariables }>();

providerRoutes.use('*', authMiddleware);

async function readJson(c: Context<{ Variables: GatewayVariables }>) {
  return c.req.json().catch(() => {
    return null;
  });
}

function parseProvider(value: string) {
  const result = providerKeySchema.safeParse(value);
  if (!result.success) {
    throw new AppError({
      message: 'Unsupported provider',
      statusCode: 400,
      code: 'GATEWAY_BAD_REQUEST',
      details: result.error.flatten(),
    });
  }

  return result.data;
}

providerRoutes.post('/providers/:provider/chat/respond', async (c) => {
  const provider = parseProvider(c.req.param('provider'));
  const payload = parseJsonWithSchema(await readJson(c), chatRespondRequestSchema);
  const requestId = payload.requestId ?? c.get('requestId');

  switch (provider) {
    case 'openai':
      return c.json(await respondWithOpenAi(payload, requestId));
    case 'anthropic':
      return c.json(await respondWithAnthropic(payload, requestId));
    case 'gemini':
      return c.json(await respondWithGemini(payload, requestId));
    case 'nano-banana':
      throw createUnsupportedOperationError(provider, 'interactive chat');
    default:
      return c.notFound();
  }
});

providerRoutes.post('/providers/:provider/jobs/execute', async (c) => {
  const provider = parseProvider(c.req.param('provider'));
  const payload = parseJsonWithSchema(await readJson(c), asyncJobRequestSchema);
  const requestId = payload.requestId ?? c.get('requestId');

  switch (provider) {
    case 'nano-banana':
      return c.json(await executeNanoBananaJob(payload, requestId));
    case 'veo':
      return c.json(await executeVeoJob(payload, requestId));
    default:
      throw createUnsupportedOperationError(provider, 'gateway async job execution');
  }
});

providerRoutes.post('/chat/respond', async (c) => {
  const payload = parseJsonWithSchema(await readJson(c), chatRespondRequestSchema);
  const requestId = payload.requestId ?? c.get('requestId');
  return c.json(await respondWithOpenAi(payload, requestId));
});
