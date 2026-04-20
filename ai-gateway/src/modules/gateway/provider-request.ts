import { env } from '../../env';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { retryAsync } from '../../lib/retry';
import {
  createNetworkError,
  createTimeoutError,
  createUpstreamHttpError,
  isRetryableGatewayError,
} from './provider-errors';
import type { GatewayProviderKey } from './gateway-types';

type ProviderFetchInput = {
  provider: GatewayProviderKey;
  route: string;
  requestId: string;
  model: string;
  url: string;
  init: RequestInit;
  userId?: string | null;
  chatId?: string | null;
  jobId?: string | null;
};

function isTimeoutError(error: unknown) {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export async function fetchProviderResponse(input: ProviderFetchInput) {
  try {
    return await retryAsync(
      async ({ attemptNumber }) => {
        const startedAt = Date.now();
        let response: Response;

        try {
          response = await fetch(input.url, {
            ...input.init,
            signal: AbortSignal.timeout(env.PROVIDER_REQUEST_TIMEOUT_MS),
          });
        } catch (error) {
          if (isTimeoutError(error)) {
            throw createTimeoutError(input.provider);
          }

          if (error instanceof TypeError) {
            throw createNetworkError(input.provider, error);
          }

          throw error;
        }

        const upstreamRequestId = response.headers.get('x-request-id') ?? response.headers.get('request-id');
        const latencyMs = Date.now() - startedAt;

        if (!response.ok) {
          const rawBody = await response.text().catch(() => '');
          throw createUpstreamHttpError({
            provider: input.provider,
            status: response.status,
            upstreamRequestId,
            rawBody,
          });
        }

        logger.info('provider_upstream_completed', {
          route: input.route,
          requestId: input.requestId,
          provider: input.provider,
          model: input.model,
          gatewayRegion: env.GATEWAY_REGION,
          gatewayEgressMode: env.GATEWAY_EGRESS_MODE,
          userId: input.userId ?? null,
          chatId: input.chatId ?? null,
          jobId: input.jobId ?? null,
          retryCount: attemptNumber,
          upstreamStatus: response.status,
          upstreamRequestId,
          latencyMs,
        });

        return response;
      },
      {
        maxRetries: env.PROVIDER_MAX_RETRIES,
        baseDelayMs: env.PROVIDER_RETRY_BASE_DELAY_MS,
        shouldRetry: (error) => isRetryableGatewayError(error),
        onRetry: (error, context) => {
          const appError =
            error instanceof AppError
              ? error
              : new AppError({
                  message: error instanceof Error ? error.message : 'Provider request failed',
                });
          logger.info('provider_retry_scheduled', {
            route: input.route,
            requestId: input.requestId,
            provider: input.provider,
            model: input.model,
            gatewayRegion: env.GATEWAY_REGION,
            gatewayEgressMode: env.GATEWAY_EGRESS_MODE,
            userId: input.userId ?? null,
            chatId: input.chatId ?? null,
            jobId: input.jobId ?? null,
            retryCount: context.attemptNumber + 1,
            nextDelayMs: context.nextDelayMs,
            errorCode: appError.code,
            retryable: appError.retryable ?? null,
            upstreamStatus: appError.upstreamStatus ?? null,
            upstreamRequestId: appError.upstreamRequestId ?? null,
          });
        },
      },
    );
  } catch (error) {
    const appError =
      error instanceof AppError
        ? error
        : new AppError({
            message: error instanceof Error ? error.message : 'Provider request failed',
            statusCode: 500,
            code: 'INTERNAL_ERROR',
          });

    logger.error('provider_upstream_failed', {
      route: input.route,
      requestId: input.requestId,
      provider: input.provider,
      model: input.model,
      gatewayRegion: env.GATEWAY_REGION,
      gatewayEgressMode: env.GATEWAY_EGRESS_MODE,
      userId: input.userId ?? null,
      chatId: input.chatId ?? null,
      jobId: input.jobId ?? null,
      errorCode: appError.code,
      retryable: appError.retryable ?? null,
      upstreamStatus: appError.upstreamStatus ?? null,
      upstreamRequestId: appError.upstreamRequestId ?? null,
      details: appError.details ?? null,
      message: appError.message,
    });

    throw appError;
  }
}
