import { AppError } from './errors';

export const DEFAULT_OPERATION_TIMEOUT_MS = 8000;

export async function withOperationTimeout<T>(
  label: string,
  operation: Promise<T>,
  timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new AppError(`Operation timed out: ${label}`, 504, 'OPERATION_TIMEOUT', { label }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
