import type { Context, Next } from 'hono';
import { resolveRequestId, type GatewayVariables } from '../lib/http';
import { logger } from '../lib/logger';
import { runWithLogContext } from '../lib/request-context';

type TypedContext = Context<{ Variables: GatewayVariables }>;

export async function requestIdMiddleware(c: TypedContext, next: Next) {
  const requestId = resolveRequestId(c);
  c.set('requestId', requestId);
  c.header('x-request-id', requestId);

  const startedAt = Date.now();
  await runWithLogContext({ requestId }, async () => {
    await next();
  });

  logger.info('request_completed', {
    route: c.req.path,
    method: c.req.method,
    status: c.res.status,
    latencyMs: Date.now() - startedAt,
  });
}
