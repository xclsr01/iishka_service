import { Hono } from 'hono';
import { env } from '../env';

export const healthRoutes = new Hono();

healthRoutes.get('/health', (c) => {
  return c.json({
    ok: true,
    service: 'ai-gateway',
    env: env.APP_ENV,
    region: env.GATEWAY_REGION,
    egressMode: env.GATEWAY_EGRESS_MODE,
  });
});

healthRoutes.get('/ready', (c) => {
  return c.json({
    ok: true,
    ready: true,
    region: env.GATEWAY_REGION,
    egressMode: env.GATEWAY_EGRESS_MODE,
  });
});
