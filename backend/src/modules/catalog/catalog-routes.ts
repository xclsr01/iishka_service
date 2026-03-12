import { ProviderStatus } from '@prisma/client';
import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import type { AppVariables } from '../../types';

export const catalogRoutes = new Hono<{ Variables: AppVariables }>();

catalogRoutes.use('*', authMiddleware);

catalogRoutes.get('/providers', async (c) => {
  const providers = await prisma.provider.findMany({
    where: { status: ProviderStatus.ACTIVE },
    orderBy: { name: 'asc' },
  });

  return c.json({ providers });
});
