import { randomUUID } from 'node:crypto';
import path from 'node:path';
import mime from 'mime';
import { allowedUploadMimeTypes, env } from '../../env';
import { sha256Hex } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { LocalStorageAdapter } from './storage/local-storage';
import { SupabaseStorageAdapter } from './storage/supabase-storage';
import type { StorageAdapter } from './storage/storage-adapter';

function createStorageAdapter(): StorageAdapter {
  if (env.UPLOAD_STORAGE_DRIVER === 'supabase') {
    return new SupabaseStorageAdapter();
  }

  return new LocalStorageAdapter();
}

const storage = createStorageAdapter();

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function persistFileRecord(input: {
  userId: string;
  originalName: string;
  mimeType: string;
  bytes: Uint8Array;
}) {
  const ext = path.extname(input.originalName) || '';
  const checksumSha256 = sha256Hex(Buffer.from(input.bytes));
  const storageKey = `${input.userId}/${randomUUID()}-${sanitizeFilename(input.originalName.replace(ext, ''))}${ext}`;

  await storage.putObject({
    storageKey,
    content: input.bytes,
    mimeType: input.mimeType,
  });

  return prisma.fileAsset.create({
    data: {
      userId: input.userId,
      originalName: sanitizeFilename(input.originalName),
      storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      checksumSha256,
    },
  });
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
  return persistFileRecord({
    userId,
    originalName: upload.name,
    mimeType,
    bytes,
  });
}

export async function persistGeneratedFile(input: {
  userId: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}) {
  return persistFileRecord({
    userId: input.userId,
    originalName: input.filename,
    mimeType: input.mimeType,
    bytes: input.bytes,
  });
}

export async function getOwnedFileContent(userId: string, fileId: string) {
  const file = await prisma.fileAsset.findFirst({
    where: {
      id: fileId,
      userId,
      status: 'READY',
    },
  });

  if (!file) {
    throw new AppError('File not found', 404, 'FILE_NOT_FOUND');
  }

  const object = await storage.getObject({
    storageKey: file.storageKey,
  });

  return {
    file,
    content: object.content,
    mimeType: object.mimeType || file.mimeType,
  };
}

export async function deleteStoredFiles(storageKeys: string[]) {
  for (const storageKey of storageKeys) {
    await storage.deleteObject({ storageKey });
  }
}
