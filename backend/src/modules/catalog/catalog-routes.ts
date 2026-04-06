import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import type { AppVariables } from '../../types';
import { listActiveProviders } from './catalog-service';

export const catalogRoutes = new Hono<{ Variables: AppVariables }>();

catalogRoutes.use('*', authMiddleware);

catalogRoutes.get('/providers', async (c) => {
  const providers = await listActiveProviders();
  return c.json({ providers });
});
