import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors';

type SessionPayload = {
  sub: string;
  telegramUserId: string;
  username?: string | null;
  exp: number;
};

function base64UrlEncode(input: string) {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecode(input: string) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signRaw(input: string, secret: string) {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

export function signSession(
  payload: Omit<SessionPayload, 'exp'>,
  secret: string,
  ttlMinutes: number,
) {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlMinutes * 60,
  };
  const encoded = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = signRaw(encoded, secret);
  return `${encoded}.${signature}`;
}

export function verifySession(token: string, secret: string) {
  const [encoded, signature] = token.split('.');

  if (!encoded || !signature) {
    throw new AppError('Invalid session token', 401, 'UNAUTHORIZED');
  }

  const expected = signRaw(encoded, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new AppError('Invalid session token', 401, 'UNAUTHORIZED');
  }

  const payload = JSON.parse(base64UrlDecode(encoded)) as SessionPayload;

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new AppError('Session expired', 401, 'UNAUTHORIZED');
  }

  return payload;
}

type TelegramAuthUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
  photo_url?: string;
};

export function verifyTelegramInitData(
  initDataRaw: string,
  botToken: string,
  ttlSeconds: number,
) {
  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash');

  if (!hash) {
    throw new AppError('Missing Telegram auth hash', 401, 'UNAUTHORIZED');
  }

  const authDateRaw = params.get('auth_date');
  if (!authDateRaw) {
    throw new AppError('Missing Telegram auth date', 401, 'UNAUTHORIZED');
  }

  const authDate = Number(authDateRaw);
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (Number.isNaN(authDate) || ageSeconds > ttlSeconds) {
    throw new AppError('Telegram auth expired', 401, 'UNAUTHORIZED');
  }

  const dataCheckString = Array.from(params.entries())
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  // Telegram Mini App initData uses an HMAC-derived secret with the fixed "WebAppData" key.
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const hashBuffer = Buffer.from(hash);
  const calculatedBuffer = Buffer.from(calculatedHash);

  if (
    hashBuffer.length !== calculatedBuffer.length ||
    !timingSafeEqual(hashBuffer, calculatedBuffer)
  ) {
    throw new AppError('Invalid Telegram auth', 401, 'UNAUTHORIZED');
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    throw new AppError('Missing Telegram user', 401, 'UNAUTHORIZED');
  }

  return JSON.parse(userRaw) as TelegramAuthUser;
}
