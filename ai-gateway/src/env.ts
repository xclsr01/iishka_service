import 'dotenv/config';
import { DEFAULT_MODELS } from '@iishka/model-config';
import { z } from 'zod';

if (
  !process.env.AI_GATEWAY_INTERNAL_TOKEN &&
  process.env.OPENAI_GATEWAY_INTERNAL_TOKEN
) {
  process.env.AI_GATEWAY_INTERNAL_TOKEN =
    process.env.OPENAI_GATEWAY_INTERNAL_TOKEN;
}

const placeholderToken = 'replace-me';
const placeholderSecret =
  'replace-this-placeholder-secret-before-production-use-0000000000000000';

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  GATEWAY_REGION: z.string().min(1).default('asia-southeast1'),
  GATEWAY_EGRESS_MODE: z
    .enum(['default', 'cloud-nat-static-ip'])
    .default('default'),
  AI_GATEWAY_INTERNAL_TOKEN: z.string().min(32),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_DEFAULT_MODEL: z.string().min(1).default(DEFAULT_MODELS.OPENAI),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),
  ANTHROPIC_DEFAULT_MODEL: z
    .string()
    .min(1)
    .default(DEFAULT_MODELS.ANTHROPIC),
  ANTHROPIC_VERSION: z.string().min(1).default('2023-06-01'),
  GOOGLE_AI_API_KEY: z.string().min(1),
  GOOGLE_AI_BASE_URL: z
    .string()
    .url()
    .default('https://generativelanguage.googleapis.com'),
  GOOGLE_AI_DEFAULT_MODEL: z.string().min(1).default(DEFAULT_MODELS.GEMINI),
  NANO_BANANA_DEFAULT_MODEL: z
    .string()
    .min(1)
    .default(DEFAULT_MODELS.NANO_BANANA),
  VEO_DEFAULT_MODEL: z.string().min(1).default(DEFAULT_MODELS.VEO),
  PROVIDER_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15000),
  PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  PROVIDER_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(300),
});

type GatewayEnv = z.infer<typeof envSchema>;

function isPlaceholderValue(value: string | undefined, placeholders: string[]) {
  if (!value) {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  return (
    placeholders.some(
      (placeholder) => normalized === placeholder.toLowerCase(),
    ) ||
    normalized.includes('replace-this-placeholder') ||
    normalized === placeholderToken
  );
}

function requireProductionValue(
  env: GatewayEnv,
  key: keyof GatewayEnv,
  placeholders: string[],
  errors: string[],
) {
  const value = env[key];
  if (typeof value !== 'string' || isPlaceholderValue(value, placeholders)) {
    errors.push(
      `${String(key)} must be configured with a non-placeholder production value`,
    );
  }
}

function validateProductionEnv(env: GatewayEnv) {
  if (env.APP_ENV !== 'production') {
    return;
  }

  const errors: string[] = [];
  requireProductionValue(
    env,
    'AI_GATEWAY_INTERNAL_TOKEN',
    [placeholderSecret],
    errors,
  );
  requireProductionValue(env, 'OPENAI_API_KEY', [placeholderToken], errors);
  requireProductionValue(env, 'ANTHROPIC_API_KEY', [placeholderToken], errors);
  requireProductionValue(env, 'GOOGLE_AI_API_KEY', [placeholderToken], errors);

  if (errors.length > 0) {
    throw new Error(
      `Invalid AI Gateway production environment:\n- ${errors.join('\n- ')}`,
    );
  }
}

export function parseGatewayEnv(source: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(source);
  validateProductionEnv(parsed);
  return parsed;
}

export const env = parseGatewayEnv(process.env);
