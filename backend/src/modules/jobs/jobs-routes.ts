import { GenerationJobKind, GenerationJobStatus } from '@prisma/client';
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

const listGenerationJobsSchema = z.object({
  providerId: z.string().min(1).optional(),
  kind: z.nativeEnum(GenerationJobKind).optional(),
  status: z.nativeEnum(GenerationJobStatus).optional(),
  limit: z.coerce.number().int().positive().max(20).default(10),
});

export const jobsRoutes = new Hono<{ Variables: AppVariables }>();

jobsRoutes.use('*', authMiddleware);

jobsRoutes.get('/', async (c) => {
  const session = c.get('authSession');
  const query = listGenerationJobsSchema.parse({
    providerId: c.req.query('providerId'),
    kind: c.req.query('kind'),
    status: c.req.query('status'),
    limit: c.req.query('limit'),
  });
  const jobs = await listGenerationJobs({
    userId: session.userId,
    providerId: query.providerId,
    kind: query.kind,
    status: query.status,
    limit: query.limit,
  });
  return c.json({ jobs });
});

jobsRoutes.post('/', async (c) => {
  const session = c.get('authSession');
  const payload = createGenerationJobSchema.parse(await c.req.json());

  const job = await createGenerationJob({
    userId: session.userId,
    providerId: payload.providerId,
    kind: payload.kind,
    prompt: payload.prompt,
    chatId: payload.chatId,
    metadata: payload.metadata,
  });

  return c.json({ job }, 201);
});

jobsRoutes.get('/:jobId', async (c) => {
  const session = c.get('authSession');
  const job = await getGenerationJob(session.userId, c.req.param('jobId'));
  return c.json({ job });
});
