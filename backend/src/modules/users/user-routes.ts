import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import type { AppVariables } from '../../types';
import { assertPresent } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import { withOperationTimeout } from '../../lib/timeout';

export const userRoutes = new Hono<{ Variables: AppVariables }>();

userRoutes.use('*', authMiddleware);

userRoutes.get('/', async (c) => {
  const session = c.get('authSession');
  const user = await withOperationTimeout(
    'users.getCurrent',
    prisma.user.findUnique({
      where: { id: session.userId },
    }),
  );

  return c.json({
    user: assertPresent(user, 'User not found'),
  });
});
