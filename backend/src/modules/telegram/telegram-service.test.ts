import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleTelegramWebhook, resolveMiniAppUrl } from './telegram-service';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('handleTelegramWebhook sends the Mini App welcome message on /start', async () => {
  let calledUrl = '';
  let calledPayload: Record<string, unknown> | null = null;

  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledPayload = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  await handleTelegramWebhook({
    message: {
      chat: { id: 77 },
      text: '/start',
      from: { first_name: 'Artem' },
    },
  });

  assert.match(calledUrl, /sendMessage$/);
  assert.equal(calledPayload?.chat_id, 77);
  assert.match(String(calledPayload?.text), /Open the Mini App/);
  assert.equal(
    (
      (calledPayload?.reply_markup as { inline_keyboard: Array<Array<{ web_app?: { url: string } }>> })
        .inline_keyboard[0][0].web_app?.url
    ),
    resolveMiniAppUrl(),
  );
});

test('handleTelegramWebhook replies with help text for unsupported messages', async () => {
  let calledPayload: Record<string, unknown> | null = null;

  globalThis.fetch = async (_input, init) => {
    calledPayload = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  await handleTelegramWebhook({
    message: {
      chat: { id: 77 },
      text: 'hello bot',
    },
  });

  assert.match(String(calledPayload?.text), /Use \/start/);
});
