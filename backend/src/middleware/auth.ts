import type { Context, Next } from 'hono';
import { env } from '../env';
import { verifySession } from '../lib/auth';
import { AppError } from '../lib/errors';
import { appendLogContext } from '../lib/request-context';
import type { AppVariables } from '../types';

type TypedContext = Context<{ Variables: AppVariables }>;

export async function authMiddleware(c: TypedContext, next: Next) {
  const header = c.req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    throw new AppError('Missing authorization token', 401, 'UNAUTHORIZED');
  }

  const payload = verifySession(token, env.JWT_SECRET);
  c.set('authSession', {
    userId: payload.sub,
    telegramUserId: payload.telegramUserId,
    username: payload.username ?? null,
  });
  appendLogContext({
    userId: payload.sub,
    telegramUserId: payload.telegramUserId,
  });

  await next();
}
