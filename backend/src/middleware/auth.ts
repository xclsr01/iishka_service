import type { Context, Next } from 'hono';
import { env } from '../env';
import { verifySession } from '../lib/auth';
import { AppError } from '../lib/errors';
import { appendLogContext } from '../lib/request-context';
import { prisma } from '../lib/prisma';
import { withOperationTimeout } from '../lib/timeout';
import type { AppVariables } from '../types';

type TypedContext = Context<{ Variables: AppVariables }>;

export async function authMiddleware(c: TypedContext, next: Next) {
  const header = c.req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    throw new AppError('Missing authorization token', 401, 'UNAUTHORIZED');
  }

  const payload = verifySession(token, env.JWT_SECRET);
  const user = await withOperationTimeout(
    'auth.findUser',
    prisma.user.findUnique({
      where: { id: payload.sub },
    }),
  );

  if (!user) {
    throw new AppError('User not found', 401, 'UNAUTHORIZED');
  }

  c.set('authSession', {
    userId: user.id,
    telegramUserId: payload.telegramUserId,
    username: payload.username ?? null,
  });
  c.set('currentUser', user);
  appendLogContext({
    userId: user.id,
    telegramUserId: user.telegramUserId,
  });

  await next();
}
