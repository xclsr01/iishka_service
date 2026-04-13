import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8081),
  OPENAI_GATEWAY_INTERNAL_TOKEN: z.string().min(32),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  OPENAI_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(300),
  OPENAI_DEFAULT_MODEL: z.string().min(1).default('gpt-4.1-mini'),
});

export const env = envSchema.parse(process.env);
