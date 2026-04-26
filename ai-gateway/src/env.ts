import 'dotenv/config';
import { z } from 'zod';

if (!process.env.AI_GATEWAY_INTERNAL_TOKEN && process.env.OPENAI_GATEWAY_INTERNAL_TOKEN) {
  process.env.AI_GATEWAY_INTERNAL_TOKEN = process.env.OPENAI_GATEWAY_INTERNAL_TOKEN;
}

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  GATEWAY_REGION: z.string().min(1).default('asia-southeast1'),
  GATEWAY_EGRESS_MODE: z.enum(['default', 'cloud-nat-static-ip']).default('default'),
  AI_GATEWAY_INTERNAL_TOKEN: z.string().min(32),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_DEFAULT_MODEL: z.string().min(1).default('gpt-5.4-mini'),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),
  ANTHROPIC_DEFAULT_MODEL: z.string().min(1).default('claude-3-5-sonnet-latest'),
  ANTHROPIC_VERSION: z.string().min(1).default('2023-06-01'),
  GOOGLE_AI_API_KEY: z.string().min(1),
  GOOGLE_AI_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com'),
  GOOGLE_AI_DEFAULT_MODEL: z.string().min(1).default('gemini-3.0-flash'),
  NANO_BANANA_DEFAULT_MODEL: z.string().min(1).default('gemini-2.5-flash-image'),
  VEO_DEFAULT_MODEL: z.string().min(1).default('veo-3.1-fast-generate-preview'),
  PROVIDER_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  PROVIDER_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(300),
});

export const env = envSchema.parse(process.env);
