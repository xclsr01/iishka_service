import { env } from '../../env';
import { AppError } from '../../lib/errors';

export function verifyInternalBearerAuth(headerValue: string | undefined) {
  const token = headerValue?.startsWith('Bearer ') ? headerValue.slice(7).trim() : null;

  if (!token || token !== env.OPENAI_GATEWAY_INTERNAL_TOKEN) {
    throw new AppError({
      message: 'Unauthorized',
      statusCode: 401,
      code: 'GATEWAY_UNAUTHORIZED',
    });
  }
}
