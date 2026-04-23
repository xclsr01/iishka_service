import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

  async getObject(input: { storageKey: string }) {
    const fullPath = path.resolve(process.cwd(), env.UPLOAD_LOCAL_DIR, input.storageKey);
    const content = await readFile(fullPath);
    return {
      content: new Uint8Array(content),
      mimeType: null,
    };
  }

  async deleteObject(input: { storageKey: string }) {
    const fullPath = path.resolve(process.cwd(), env.UPLOAD_LOCAL_DIR, input.storageKey);
    await rm(fullPath, { force: true });
  }
}
