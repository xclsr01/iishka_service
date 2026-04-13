import type { Context, Next } from 'hono';
import { verifyInternalBearerAuth } from '../modules/auth/internal-auth';

export async function authMiddleware(c: Context, next: Next) {
  verifyInternalBearerAuth(c.req.header('authorization'));
  await next();
}
