import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import type { AppVariables } from '../../types';
import { AppError } from '../../lib/errors';
import { contentDisposition } from '../../lib/content-disposition';
import {
  createOwnedFileLinks,
  getFileContentByToken,
  getOwnedFileContent,
  persistUploadedFile,
} from './file-service';
import { createRateLimitMiddleware } from '../../middleware/rate-limit';

export const fileRoutes = new Hono<{ Variables: AppVariables }>();

function fileContentResponse(input: {
  content: Uint8Array;
  mimeType: string;
  filename: string;
  disposition: 'inline' | 'attachment';
}) {
  return new Response(Buffer.from(input.content), {
    status: 200,
    headers: {
      'content-type': input.mimeType,
      'content-length': String(input.content.byteLength),
      'content-disposition': contentDisposition(
        input.disposition,
        input.filename,
        'iishka-file',
      ),
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': 'https://web.telegram.org',
    },
  });
}

fileRoutes.get('/:fileId/public-content', async (c) => {
  const token = c.req.query('token');
  if (!token) {
    throw new AppError('Missing file link token', 401, 'UNAUTHORIZED');
  }

  const disposition =
    c.req.query('disposition') === 'attachment' ? 'attachment' : 'inline';
  const resolved = await getFileContentByToken(token, c.req.param('fileId'));

  return fileContentResponse({
    content: resolved.content,
    mimeType: resolved.mimeType,
    filename: resolved.file.originalName,
    disposition,
  });
});

fileRoutes.use('*', authMiddleware);

fileRoutes.post('/', createRateLimitMiddleware('file_upload'), async (c) => {
  const session = c.get('authSession');
  const body = await c.req.parseBody();
  const candidate = body.file;

  if (!(candidate instanceof File)) {
    throw new AppError('Expected multipart file upload', 400, 'INVALID_UPLOAD');
  }

  const file = await persistUploadedFile(session.userId, candidate);
  return c.json({ file }, 201);
});

fileRoutes.get('/:fileId/content', async (c) => {
  const session = c.get('authSession');
  const resolved = await getOwnedFileContent(
    session.userId,
    c.req.param('fileId'),
  );
  const disposition =
    c.req.query('disposition') === 'attachment' ? 'attachment' : 'inline';

  return fileContentResponse({
    content: resolved.content,
    mimeType: resolved.mimeType,
    filename: resolved.file.originalName,
    disposition,
  });
});

fileRoutes.get(
  '/:fileId/links',
  createRateLimitMiddleware('download_link'),
  async (c) => {
    const session = c.get('authSession');
    const links = await createOwnedFileLinks(
      session.userId,
      c.req.param('fileId'),
    );
    return c.json(links);
  },
);
