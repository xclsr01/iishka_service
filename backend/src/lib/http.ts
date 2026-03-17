import { AppError } from './errors';

export function assertPresent<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new AppError(message, 404, 'NOT_FOUND');
  }

  return value;
}

export function jsonSafeError(error: AppError) {
  const isProviderFailure =
    error.code === 'PROVIDER_REQUEST_FAILED' || error.code === 'PROVIDER_EMPTY_RESPONSE';

  return {
    error: {
      code: error.code,
      message:
        error.statusCode >= 500 && !isProviderFailure
          ? 'Internal server error'
          : error.message,
    },
  };
}
