import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../../env';
import type { StorageAdapter } from './storage-adapter';

export class LocalStorageAdapter implements StorageAdapter {
  async putObject(input: { storageKey: string; content: Uint8Array }) {
    const fullPath = path.resolve(process.cwd(), env.UPLOAD_LOCAL_DIR, input.storageKey);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, input.content);
    return { storageKey: input.storageKey };
  }
}
