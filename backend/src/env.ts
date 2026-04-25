import { z } from 'zod';
import { validateSupabaseServiceRoleKey } from './lib/supabase-key';

if (!process.env.DEV_AUTH_SHARED_SECRET && process.env.VITE_DEV_AUTH_SHARED_SECRET) {
  process.env.DEV_AUTH_SHARED_SECRET = process.env.VITE_DEV_AUTH_SHARED_SECRET;
}

const placeholderUrl = 'https://example.invalid';
const placeholderSecret =
  'replace-this-placeholder-secret-before-production-use-0000000000000000';
const placeholderToken = 'replace-me';
const placeholderDatabaseUrl = 'postgresql://user:password@localhost:5432/iishka_service';
const optionalUrl = z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional());
const optionalSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(32).optional(),
);

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  FRONTEND_URL: z.string().url().default(placeholderUrl),
  API_BASE_URL: z.string().url().default(placeholderUrl),
  DATABASE_URL: z.string().min(1).default(placeholderDatabaseUrl),
  DIRECT_URL: z.string().min(1).default(process.env.DATABASE_URL ?? placeholderDatabaseUrl),
  JWT_SECRET: z.string().min(32).default(placeholderSecret),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(60 * 24 * 7),
  TELEGRAM_INIT_DATA_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  TELEGRAM_BOT_TOKEN: z.string().min(1).default(placeholderToken),
  TELEGRAM_BOT_USERNAME: z.string().min(1).default('placeholder_bot'),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1).default(placeholderSecret),
  TELEGRAM_MINI_APP_URL: z.string().url().default(placeholderUrl),
  TELEGRAM_DELIVERY_MODE: z.enum(['webhook', 'polling', 'disabled']).default('polling'),
  OPENAI_ENABLED: z
    .string()
    .default('true')
    .transform((value) => value === 'true'),
  AI_GATEWAY_URL: optionalUrl,
  AI_GATEWAY_INTERNAL_TOKEN: optionalSecret,
  AI_GATEWAY_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  AI_GATEWAY_ASYNC_JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(11 * 60 * 1000),
  OPENAI_API_KEY: z.string().min(1).default(placeholderToken),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_GATEWAY_URL: optionalUrl,
  OPENAI_GATEWAY_INTERNAL_TOKEN: optionalSecret,
  OPENAI_MODEL: z.string().min(1).default('gpt-5.4-mini'),
  ANTHROPIC_API_KEY: z.string().min(1).default(placeholderToken),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-3-5-sonnet-latest'),
  GOOGLE_AI_API_KEY: z.string().min(1).default(placeholderToken),
  GOOGLE_AI_MODEL: z.string().min(1).default('gemini-2.0-flash'),
  NANO_BANANA_MODEL: z.string().min(1).default('gemini-2.5-flash-image'),
  VEO_MODEL: z.string().min(1).default('veo-3.1-fast-generate-preview'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  ALLOWED_UPLOAD_MIME_TYPES: z
    .string()
    .min(1)
    .default('application/pdf,image/png,image/jpeg,text/plain'),
  UPLOAD_STORAGE_DRIVER: z.enum(['local', 'supabase']).default('local'),
  UPLOAD_LOCAL_DIR: z.string().min(1).default('./storage/uploads'),
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

  const serviceRoleKeyError = validateSupabaseServiceRoleKey({
    key: env.SUPABASE_SERVICE_ROLE_KEY!,
    supabaseUrl: env.SUPABASE_URL!,
  });

  if (serviceRoleKeyError) {
    throw new Error(serviceRoleKeyError);
  }
}

if (env.AI_GATEWAY_URL && !env.AI_GATEWAY_INTERNAL_TOKEN) {
  throw new Error('AI_GATEWAY_INTERNAL_TOKEN is required when AI_GATEWAY_URL is set');
}

if (env.OPENAI_GATEWAY_URL && !env.OPENAI_GATEWAY_INTERNAL_TOKEN) {
  throw new Error('OPENAI_GATEWAY_INTERNAL_TOKEN is required when OPENAI_GATEWAY_URL is set');
}
