import { createClient } from '@supabase/supabase-js';
import { env } from '../../../env';
import { AppError } from '../../../lib/errors';
import type { StorageAdapter } from './storage-adapter';

export class SupabaseStorageAdapter implements StorageAdapter {
  private readonly client = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  async putObject(input: { storageKey: string; content: Uint8Array; mimeType: string }) {
    const { error } = await this.client.storage
      .from(env.SUPABASE_STORAGE_BUCKET!)
      .upload(input.storageKey, input.content, {
        contentType: input.mimeType,
        upsert: false,
      });

    if (error) {
      throw new AppError(
        `Supabase storage upload failed: ${error.message}`,
        502,
        'UPLOAD_FAILED',
      );
    }

    return { storageKey: input.storageKey };
  }

  async getObject(input: { storageKey: string }) {
    const { data, error } = await this.client.storage
      .from(env.SUPABASE_STORAGE_BUCKET!)
      .download(input.storageKey);

    if (error) {
      throw new AppError(
        `Supabase storage download failed: ${error.message}`,
        502,
        'UPLOAD_FAILED',
      );
    }

    return {
      content: new Uint8Array(await data.arrayBuffer()),
      mimeType: data.type || null,
    };
  }
}
