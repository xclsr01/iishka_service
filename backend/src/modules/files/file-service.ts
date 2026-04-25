import { randomUUID } from 'node:crypto';
import { createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import mime from 'mime';
import { allowedUploadMimeTypes, env } from '../../env';
import { sha256Hex } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { LocalStorageAdapter } from './storage/local-storage';
import { SupabaseStorageAdapter } from './storage/supabase-storage';
import type { StorageAdapter } from './storage/storage-adapter';

const FILE_LINK_TTL_SECONDS = 5 * 60;

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

function base64UrlEncode(input: string) {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecode(input: string) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signFileTokenPayload(encodedPayload: string) {
  return createHmac('sha256', `${env.JWT_SECRET}:file-content`)
    .update(encodedPayload)
    .digest('base64url');
}

function timingSafeStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function signFileToken(input: {
  userId: string;
  fileId: string;
  expiresAtSeconds: number;
}) {
  const encodedPayload = base64UrlEncode(JSON.stringify({
    sub: input.userId,
    fileId: input.fileId,
    exp: input.expiresAtSeconds,
  }));
  const signature = signFileTokenPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function verifyFileToken(token: string, fileId: string) {
  const [encodedPayload, signature] = token.split('.');

  if (!encodedPayload || !signature) {
    throw new AppError('Invalid file link', 401, 'UNAUTHORIZED');
  }

  const expectedSignature = signFileTokenPayload(encodedPayload);
  if (!timingSafeStringEqual(signature, expectedSignature)) {
    throw new AppError('Invalid file link', 401, 'UNAUTHORIZED');
  }

  let payload: {
    sub?: unknown;
    fileId?: unknown;
    exp?: unknown;
  };

  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as typeof payload;
  } catch {
    throw new AppError('Invalid file link', 401, 'UNAUTHORIZED');
  }

  if (
    typeof payload.sub !== 'string' ||
    payload.fileId !== fileId ||
    typeof payload.exp !== 'number' ||
    payload.exp <= Math.floor(Date.now() / 1000)
  ) {
    throw new AppError('File link expired or invalid', 401, 'UNAUTHORIZED');
  }

  return payload.sub;
}

function buildFileUrl(fileId: string, token: string, disposition: 'inline' | 'attachment') {
  const url = new URL(`/api/files/${fileId}/public-content`, env.API_BASE_URL);
  url.searchParams.set('token', token);
  url.searchParams.set('disposition', disposition);
  return url.toString();
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

export async function getFileContentByToken(token: string, fileId: string) {
  const userId = verifyFileToken(token, fileId);
  return getOwnedFileContent(userId, fileId);
}

export async function createOwnedFileLinks(userId: string, fileId: string) {
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

  const expiresAtSeconds = Math.floor(Date.now() / 1000) + FILE_LINK_TTL_SECONDS;
  const token = signFileToken({
    userId,
    fileId,
    expiresAtSeconds,
  });
  const openUrl = buildFileUrl(fileId, token, 'inline');
  const downloadUrl = buildFileUrl(fileId, token, 'attachment');

  return {
    openUrl,
    downloadUrl,
    filename: file.originalName,
    mimeType: file.mimeType,
    disposition: 'inline' as const,
    open: {
      url: openUrl,
      filename: file.originalName,
      mimeType: file.mimeType,
      disposition: 'inline' as const,
    },
    download: {
      url: downloadUrl,
      filename: file.originalName,
      mimeType: file.mimeType,
      disposition: 'attachment' as const,
    },
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
  };
}

export async function deleteStoredFiles(storageKeys: string[]) {
  for (const storageKey of storageKeys) {
    await storage.deleteObject({ storageKey });
  }
}
