import { Hono } from 'hono';

export const healthRoutes = new Hono();

healthRoutes.get('/health', (c) => {
  return c.json({
    ok: true,
    service: 'openai-gateway',
  });
});

healthRoutes.get('/ready', (c) => {
  return c.json({
    ok: true,
    ready: true,
  });
});
