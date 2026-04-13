export type RetryDecisionContext = {
  attemptNumber: number;
};

export type RetryOptions = {
  maxRetries: number;
  baseDelayMs: number;
  shouldRetry(error: unknown, context: RetryDecisionContext): boolean;
  onRetry?(error: unknown, context: RetryDecisionContext & { nextDelayMs: number }): void;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function computeDelay(baseDelayMs: number, attemptNumber: number) {
  const exponential = baseDelayMs * 2 ** attemptNumber;
  const jitter = Math.floor(Math.random() * Math.max(25, Math.round(baseDelayMs * 0.3)));
  return exponential + jitter;
}

export async function retryAsync<T>(
  operation: (context: RetryDecisionContext) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  let attemptNumber = 0;

  while (true) {
    try {
      return await operation({ attemptNumber });
    } catch (error) {
      const context = { attemptNumber };

      if (attemptNumber >= options.maxRetries || !options.shouldRetry(error, context)) {
        throw error;
      }

      const nextDelayMs = computeDelay(options.baseDelayMs, attemptNumber);
      options.onRetry?.(error, {
        attemptNumber,
        nextDelayMs,
      });
      await sleep(nextDelayMs);
      attemptNumber += 1;
    }
  }
}
