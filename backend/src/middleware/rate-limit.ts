import type { Context, MiddlewareHandler } from 'hono';
import { env } from '../env';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import type { AppVariables } from '../types';

export type RateLimitPolicyName =
  | 'auth_bootstrap'
  | 'file_upload'
  | 'job_create'
  | 'message_create'
  | 'message_retry'
  | 'download_link';

export type RateLimitIdentity = 'user' | 'anonymous';

export type RateLimitPolicy = {
  name: RateLimitPolicyName;
  limit: number;
  windowSeconds: number;
  identity: RateLimitIdentity;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

export interface RateLimiter {
  hit(input: {
    key: string;
    limit: number;
    windowSeconds: number;
  }): Promise<RateLimitResult>;
}

type Bucket = {
  count: number;
  resetAt: number;
};

const DEFAULT_RATE_LIMIT_POLICIES: Record<
  RateLimitPolicyName,
  RateLimitPolicy
> = {
  auth_bootstrap: {
    name: 'auth_bootstrap',
    limit: 20,
    windowSeconds: 60,
    identity: 'anonymous',
  },
  file_upload: {
    name: 'file_upload',
    limit: 20,
    windowSeconds: 60 * 60,
    identity: 'user',
  },
  job_create: {
    name: 'job_create',
    limit: 30,
    windowSeconds: 10 * 60,
    identity: 'user',
  },
  message_create: {
    name: 'message_create',
    limit: 60,
    windowSeconds: 60,
    identity: 'user',
  },
  message_retry: {
    name: 'message_retry',
    limit: 20,
    windowSeconds: 10 * 60,
    identity: 'user',
  },
  download_link: {
    name: 'download_link',
    limit: 120,
    windowSeconds: 60,
    identity: 'user',
  },
};

function clampRemaining(limit: number, count: number) {
  return Math.max(0, limit - count);
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  async hit(input: {
    key: string;
    limit: number;
    windowSeconds: number;
  }): Promise<RateLimitResult> {
    const now = Date.now();
    const current = this.buckets.get(input.key);

    if (!current || current.resetAt <= now) {
      const resetAt = now + input.windowSeconds * 1000;
      this.buckets.set(input.key, {
        count: 1,
        resetAt,
      });

      return {
        allowed: true,
        limit: input.limit,
        remaining: clampRemaining(input.limit, 1),
        resetAt,
      };
    }

    if (current.count >= input.limit) {
      return {
        allowed: false,
        limit: input.limit,
        remaining: 0,
        resetAt: current.resetAt,
      };
    }

    current.count += 1;
    return {
      allowed: true,
      limit: input.limit,
      remaining: clampRemaining(input.limit, current.count),
      resetAt: current.resetAt,
    };
  }

  clear() {
    this.buckets.clear();
  }
}

export class UpstashRateLimiter implements RateLimiter {
  constructor(
    private readonly input: {
      url: string;
      token: string;
    },
  ) {}

  async hit(input: {
    key: string;
    limit: number;
    windowSeconds: number;
  }): Promise<RateLimitResult> {
    const resetAt = Date.now() + input.windowSeconds * 1000;
    const baseUrl = this.input.url.replace(/\/+$/, '');
    const headers = {
      authorization: `Bearer ${this.input.token}`,
      'content-type': 'application/json',
    };

    const incrementResponse = await fetch(
      `${baseUrl}/incr/${encodeURIComponent(input.key)}`,
      {
        method: 'POST',
        headers,
      },
    );

    if (!incrementResponse.ok) {
      throw new AppError(
        'Rate limiter store unavailable',
        503,
        'RATE_LIMITER_UNAVAILABLE',
      );
    }

    const incrementPayload = (await incrementResponse.json()) as {
      result?: number;
    };
    const count = incrementPayload.result ?? 0;

    if (count === 1) {
      await fetch(
        `${baseUrl}/expire/${encodeURIComponent(input.key)}/${input.windowSeconds}`,
        {
          method: 'POST',
          headers,
        },
      ).catch(() => undefined);
    }

    return {
      allowed: count <= input.limit,
      limit: input.limit,
      remaining: clampRemaining(input.limit, count),
      resetAt,
    };
  }
}

let configuredLimiter: RateLimiter | null = null;
let warnedMemoryLimiter = false;

export function createMemoryRateLimiter() {
  return new MemoryRateLimiter();
}

export function createConfiguredRateLimiter(): RateLimiter {
  if (configuredLimiter) {
    return configuredLimiter;
  }

  if (env.RATE_LIMIT_DRIVER === 'upstash') {
    configuredLimiter = new UpstashRateLimiter({
      url: env.UPSTASH_REDIS_REST_URL!,
      token: env.UPSTASH_REDIS_REST_TOKEN!,
    });
    return configuredLimiter;
  }

  configuredLimiter = createMemoryRateLimiter();

  if (!warnedMemoryLimiter) {
    warnedMemoryLimiter = true;
    logger.error('rate_limiter_memory_driver_enabled', {
      appEnv: env.APP_ENV,
      warning:
        'In-memory rate limiting is process-local and must not be used in production.',
    });
  }

  return configuredLimiter;
}

function trustedClientIp(c: Context) {
  if (!env.TRUST_PLATFORM_CLIENT_IP_HEADERS) {
    return 'unknown';
  }

  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('true-client-ip') ??
    c.req.header('x-real-ip') ??
    c.req.header('fly-client-ip') ??
    'unknown'
  );
}

function resolveRateLimitKey(
  c: Context<{ Variables: AppVariables }>,
  policy: RateLimitPolicy,
) {
  if (policy.identity === 'user') {
    const session = c.get('authSession');
    if (!session?.userId) {
      throw new AppError(
        'Missing authenticated rate limit identity',
        401,
        'UNAUTHORIZED',
      );
    }

    return `policy:${policy.name}:user:${session.userId}`;
  }

  return `policy:${policy.name}:ip:${trustedClientIp(c)}`;
}

function setRateLimitHeaders(c: Context, result: RateLimitResult) {
  c.header('x-rate-limit-limit', String(result.limit));
  c.header('x-rate-limit-remaining', String(result.remaining));
  c.header('x-rate-limit-reset', String(Math.ceil(result.resetAt / 1000)));
}

export function createRateLimitMiddleware(
  policyName: RateLimitPolicyName,
  options?: {
    limiter?: RateLimiter;
    policies?: Partial<Record<RateLimitPolicyName, RateLimitPolicy>>;
  },
): MiddlewareHandler<{ Variables: AppVariables }> {
  const policy =
    options?.policies?.[policyName] ?? DEFAULT_RATE_LIMIT_POLICIES[policyName];
  const limiter = options?.limiter ?? createConfiguredRateLimiter();

  return async (c, next) => {
    const key = resolveRateLimitKey(c, policy);
    const result = await limiter.hit({
      key,
      limit: policy.limit,
      windowSeconds: policy.windowSeconds,
    });

    setRateLimitHeaders(c, result);

    if (!result.allowed) {
      logger.info('rate_limit_exceeded', {
        policy: policy.name,
        identity: policy.identity,
        resetAt: new Date(result.resetAt).toISOString(),
      });
      throw new AppError('Rate limit exceeded', 429, 'RATE_LIMITED');
    }

    await next();
  };
}

export const rateLimitMiddleware = createRateLimitMiddleware;
