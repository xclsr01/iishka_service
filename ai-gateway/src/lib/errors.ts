export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  readonly retryable?: boolean;
  readonly upstreamStatus?: number;
  readonly upstreamRequestId?: string | null;

  constructor(input: {
    message: string;
    statusCode?: number;
    code?: string;
    details?: unknown;
    retryable?: boolean;
    upstreamStatus?: number;
    upstreamRequestId?: string | null;
  }) {
    super(input.message);
    this.name = 'AppError';
    this.statusCode = input.statusCode ?? 500;
    this.code = input.code ?? 'INTERNAL_ERROR';
    this.details = input.details;
    this.retryable = input.retryable;
    this.upstreamStatus = input.upstreamStatus;
    this.upstreamRequestId = input.upstreamRequestId;
  }
}

export function toAppError(error: unknown) {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError({
      message: error.message,
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
  }

  return new AppError({
    message: 'Unexpected error',
    statusCode: 500,
    code: 'INTERNAL_ERROR',
  });
}
