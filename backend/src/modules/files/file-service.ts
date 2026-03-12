import { randomUUID } from 'node:crypto';
import path from 'node:path';
import mime from 'mime';
import { allowedUploadMimeTypes, env } from '../../env';
import { sha256Hex } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { LocalStorageAdapter } from './storage/local-storage';

const storage = new LocalStorageAdapter();

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function persistUploadedFile(userId: string, upload: File) {
  if (upload.size > env.MAX_UPLOAD_BYTES) {
    throw new AppError('File too large', 400, 'FILE_TOO_LARGE');
  }

  const mimeType = upload.type || mime.getType(upload.name) || 'application/octet-stream';
  if (!allowedUploadMimeTypes.includes(mimeType)) {
    throw new AppError('Unsupported file type', 400, 'UNSUPPORTED_FILE_TYPE');
  }

  const bytes = new Uint8Array(await upload.arrayBuffer());
  const checksumSha256 = sha256Hex(Buffer.from(bytes));
  const ext = path.extname(upload.name) || '';
  const storageKey = `${userId}/${randomUUID()}-${sanitizeFilename(upload.name.replace(ext, ''))}${ext}`;

  await storage.putObject({
    storageKey,
    content: bytes,
    mimeType,
  });

  return prisma.fileAsset.create({
    data: {
      userId,
      originalName: sanitizeFilename(upload.name),
      storageKey,
      mimeType,
      sizeBytes: upload.size,
      checksumSha256,
    },
  });
}
