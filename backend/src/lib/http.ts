import { AppError } from './errors';

export function assertPresent<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new AppError(message, 404, 'NOT_FOUND');
  }

  return value;
}

export function jsonSafeError(error: AppError) {
  return {
    error: {
      code: error.code,
      message: error.statusCode >= 500 ? 'Internal server error' : error.message,
    },
  };
}
