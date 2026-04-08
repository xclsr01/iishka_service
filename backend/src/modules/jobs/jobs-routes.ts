import { GenerationJobKind } from '@prisma/client';
import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import type { AppVariables } from '../../types';
import { createGenerationJob, getGenerationJob, listGenerationJobs } from './jobs-service';

const createGenerationJobSchema = z.object({
  providerId: z.string().min(1),
  kind: z.nativeEnum(GenerationJobKind),
  prompt: z.string().trim().min(1).max(12000),
  chatId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const jobsRoutes = new Hono<{ Variables: AppVariables }>();

jobsRoutes.use('*', authMiddleware);

jobsRoutes.get('/', async (c) => {
  const user = c.get('currentUser');
  const jobs = await listGenerationJobs(user.id);
  return c.json({ jobs });
});

jobsRoutes.post('/', async (c) => {
  const user = c.get('currentUser');
  const payload = createGenerationJobSchema.parse(await c.req.json());
  const executionCtx =
    'executionCtx' in c && c.executionCtx && typeof c.executionCtx.waitUntil === 'function'
      ? c.executionCtx
      : null;
  const job = await createGenerationJob({
    userId: user.id,
    providerId: payload.providerId,
    kind: payload.kind,
    prompt: payload.prompt,
    chatId: payload.chatId,
    metadata: payload.metadata,
  }, {
    schedule: executionCtx ? (task) => executionCtx.waitUntil(task) : undefined,
  });

  return c.json({ job }, 201);
});

jobsRoutes.get('/:jobId', async (c) => {
  const user = c.get('currentUser');
  const job = await getGenerationJob(user.id, c.req.param('jobId'));
  return c.json({ job });
});
