import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import type { AppVariables } from '../../types';

export const userRoutes = new Hono<{ Variables: AppVariables }>();

userRoutes.use('*', authMiddleware);

userRoutes.get('/', async (c) => {
  return c.json({
    user: c.get('currentUser'),
  });
});
