import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(currentDir, '..');
const repoRootDir = path.resolve(backendDir, '..');

// Load root env first for shared defaults, then backend/.env to allow backend-specific overrides.
dotenv.config({ path: path.join(repoRootDir, '.env') });
dotenv.config({ path: path.join(backendDir, '.env'), override: true });

if (!process.env.DEV_AUTH_SHARED_SECRET && process.env.VITE_DEV_AUTH_SHARED_SECRET) {
  process.env.DEV_AUTH_SHARED_SECRET = process.env.VITE_DEV_AUTH_SHARED_SECRET;
}

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  FRONTEND_URL: z.string().url(),
  API_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).default(process.env.DATABASE_URL ?? ''),
  JWT_SECRET: z.string().min(32),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(60 * 24 * 7),
  TELEGRAM_INIT_DATA_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_BOT_USERNAME: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  TELEGRAM_MINI_APP_URL: z.string().url(),
  TELEGRAM_DELIVERY_MODE: z.enum(['webhook', 'polling', 'disabled']).default('polling'),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().min(1),
  GOOGLE_AI_API_KEY: z.string().min(1),
  GOOGLE_AI_MODEL: z.string().min(1),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  ALLOWED_UPLOAD_MIME_TYPES: z.string().min(1),
  UPLOAD_STORAGE_DRIVER: z.enum(['local', 'supabase']).default('local'),
  UPLOAD_LOCAL_DIR: z.string().min(1),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().optional(),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  ENABLE_DEV_AUTH: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  DEV_AUTH_SHARED_SECRET: z.string().default(''),
  ENABLE_DEV_SUBSCRIPTION_OVERRIDE: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  PORT: z.coerce.number().int().positive().default(8787),
});

export const env = envSchema.parse(process.env);
export const allowedUploadMimeTypes = env.ALLOWED_UPLOAD_MIME_TYPES.split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (env.UPLOAD_STORAGE_DRIVER === 'supabase') {
  const missing = [
    ['SUPABASE_URL', env.SUPABASE_URL],
    ['SUPABASE_SERVICE_ROLE_KEY', env.SUPABASE_SERVICE_ROLE_KEY],
    ['SUPABASE_STORAGE_BUCKET', env.SUPABASE_STORAGE_BUCKET],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(
      `Missing Supabase storage configuration: ${missing.map(([key]) => key).join(', ')}`,
    );
  }
}
