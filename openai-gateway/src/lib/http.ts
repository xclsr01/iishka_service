import type { Context } from 'hono';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './errors';

export type GatewayVariables = {
  requestId: string;
};

export function resolveRequestId(c: Context) {
  return c.req.header('x-request-id') ?? randomUUID();
}

export function jsonSafeError(error: AppError) {
  return {
    error: {
      code: error.code,
      message: error.message,
      requestId: undefined,
    },
  };
}

export function withRequestId(error: AppError, requestId: string) {
  return {
    error: {
      code: error.code,
      message: error.message,
      requestId,
    },
  };
}

export function parseJsonWithSchema<T>(value: unknown, schema: z.ZodType<T>) {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new AppError({
      message: 'Malformed request payload',
      statusCode: 400,
      code: 'GATEWAY_BAD_REQUEST',
      details: result.error.flatten(),
    });
  }

  return result.data;
}
