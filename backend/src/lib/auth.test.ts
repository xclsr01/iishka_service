import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { signSession, verifySession, verifyTelegramInitData } from './auth';

function buildTelegramInitData(user: Record<string, unknown>, authDate: number) {
  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('query_id', 'AAHdF6IQAAAAAN0XohDhrOrc');
  params.set('user', JSON.stringify(user));

  const dataCheckString = Array.from(params.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData')
    .update(process.env.TELEGRAM_BOT_TOKEN!)
    .digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

test('signSession and verifySession round-trip a valid token', () => {
  const token = signSession(
    {
      sub: 'user_123',
      telegramUserId: '42',
      username: 'tester',
    },
    process.env.JWT_SECRET!,
    30,
  );

  const payload = verifySession(token, process.env.JWT_SECRET!);

  assert.equal(payload.sub, 'user_123');
  assert.equal(payload.telegramUserId, '42');
  assert.equal(payload.username, 'tester');
  assert.ok(payload.exp > Math.floor(Date.now() / 1000));
});

test('verifySession rejects a tampered token', () => {
  const token = signSession(
    {
      sub: 'user_123',
      telegramUserId: '42',
    },
    process.env.JWT_SECRET!,
    30,
  );

  const [encoded] = token.split('.');
  assert.throws(
    () => verifySession(`${encoded}.tampered`, process.env.JWT_SECRET!),
    /Invalid session token/,
  );
});

test('verifyTelegramInitData accepts a correctly signed payload', () => {
  const user = {
    id: 42,
    username: 'telegram_user',
    first_name: 'Test',
    last_name: 'User',
    language_code: 'en',
  };
  const initData = buildTelegramInitData(user, Math.floor(Date.now() / 1000));

  const verified = verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN!, 3600);

  assert.equal(verified.id, 42);
  assert.equal(verified.username, 'telegram_user');
});

test('verifyTelegramInitData rejects expired auth data', () => {
  const user = {
    id: 42,
    username: 'telegram_user',
  };
  const initData = buildTelegramInitData(user, Math.floor(Date.now() / 1000) - 7200);

  assert.throws(
    () => verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN!, 3600),
    /Telegram auth expired/,
  );
});
