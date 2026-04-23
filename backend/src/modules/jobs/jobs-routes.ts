import { GenerationJobKind, GenerationJobStatus } from '@prisma/client';
import { Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { authMiddleware } from '../../middleware/auth';
import type { AppVariables } from '../../types';
import {
  createGenerationJob,
  createGenerationJobImageLinks,
  getGenerationJob,
  getGenerationJobImageByToken,
  listGenerationJobs,
} from './jobs-service';

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
  limit: z.coerce.number().int().positive().max(100).default(100),
});

const imageIndexSchema = z.coerce.number().int().min(0);
const imageDispositionSchema = z.enum(['inline', 'attachment']).default('inline');

export const jobsRoutes = new Hono<{ Variables: AppVariables }>();

function contentDisposition(disposition: 'inline' | 'attachment', filename: string) {
  const safeFilename = filename.replace(/["\\\r\n]/g, '_') || 'iishka-image.png';
  return `${disposition}; filename="${safeFilename}"`;
}

jobsRoutes.get('/:jobId/images/:imageIndex', async (c) => {
  const token = c.req.query('token');
  if (!token) {
    throw new AppError('Missing image link token', 401, 'UNAUTHORIZED');
  }

  const imageIndex = imageIndexSchema.parse(c.req.param('imageIndex'));
  const disposition = imageDispositionSchema.parse(c.req.query('disposition') ?? 'inline');
  const image = await getGenerationJobImageByToken(token, c.req.param('jobId'), imageIndex);
  const body = Buffer.from(image.dataBase64, 'base64');

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': image.mimeType,
      'content-length': String(body.byteLength),
      'content-disposition': contentDisposition(disposition, image.filename),
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  });
});

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

jobsRoutes.get('/:jobId/images/:imageIndex/links', async (c) => {
  const session = c.get('authSession');
  const imageIndex = imageIndexSchema.parse(c.req.param('imageIndex'));
  const links = await createGenerationJobImageLinks(session.userId, c.req.param('jobId'), imageIndex);
  return c.json(links);
});
