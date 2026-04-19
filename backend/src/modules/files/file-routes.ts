import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import type { AppVariables } from '../../types';
import { AppError } from '../../lib/errors';
import { persistUploadedFile } from './file-service';

export const fileRoutes = new Hono<{ Variables: AppVariables }>();

fileRoutes.use('*', authMiddleware);

fileRoutes.post('/', async (c) => {
  const session = c.get('authSession');
  const body = await c.req.parseBody();
  const candidate = body.file;

  if (!(candidate instanceof File)) {
    throw new AppError('Expected multipart file upload', 400, 'INVALID_UPLOAD');
  }

  const file = await persistUploadedFile(session.userId, candidate);
  return c.json({ file }, 201);
});
