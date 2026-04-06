import { AppError } from './errors';
import { ProviderAdapterError } from '../modules/providers/provider-types';
import { toClientSafeProviderMessage } from '../modules/providers/provider-error-mapping';

export function assertPresent<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new AppError(message, 404, 'NOT_FOUND');
  }

  return value;
}

export function jsonSafeError(error: AppError) {
  if (error instanceof ProviderAdapterError) {
    return {
      error: {
        code: error.code,
        message: toClientSafeProviderMessage(error),
      },
    };
  }

  return {
    error: {
      code: error.code,
      message: error.statusCode >= 500 ? 'Internal server error' : error.message,
    },
  };
}
