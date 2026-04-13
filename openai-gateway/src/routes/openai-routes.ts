import { Hono } from 'hono';
import { parseJsonWithSchema, type GatewayVariables } from '../lib/http';
import { authMiddleware } from '../middleware/auth';
import { respondWithOpenAi } from '../modules/openai/openai-service';
import { chatRespondRequestSchema } from '../modules/openai/openai-validation';

export const openaiRoutes = new Hono<{ Variables: GatewayVariables }>();

openaiRoutes.use('*', authMiddleware);

openaiRoutes.post('/chat/respond', async (c) => {
  const rawPayload = await c.req.json().catch(() => {
    return null;
  });
  const payload = parseJsonWithSchema(rawPayload, chatRespondRequestSchema);
  const requestId = payload.requestId ?? c.get('requestId');
  const response = await respondWithOpenAi(payload, requestId);

  return c.json(response);
});
