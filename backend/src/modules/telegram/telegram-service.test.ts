import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleTelegramWebhook, resolveMiniAppUrl } from './telegram-service';

const originalFetch = globalThis.fetch;

type SendMessagePayload = {
  chat_id: number;
  text: string;
  reply_markup?: {
    inline_keyboard: Array<Array<{ text?: string; web_app?: { url: string } }>>;
  };
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('handleTelegramWebhook sends the Mini App welcome message on /start', async () => {
  let calledUrl = '';
  let calledPayload: SendMessagePayload | null = null;

  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledPayload = JSON.parse(String(init?.body)) as SendMessagePayload;
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
  assert.ok(calledPayload);
  assert.equal(calledPayload.chat_id, 77);
  assert.match(calledPayload.text, /Open the Mini App/);
  assert.equal(calledPayload.reply_markup?.inline_keyboard[0]?.[0]?.web_app?.url, resolveMiniAppUrl());
});

test('handleTelegramWebhook replies with help text for unsupported messages', async () => {
  let calledPayload: SendMessagePayload | null = null;

  globalThis.fetch = async (_input, init) => {
    calledPayload = JSON.parse(String(init?.body)) as SendMessagePayload;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  await handleTelegramWebhook({
    message: {
      chat: { id: 77 },
      text: 'hello bot',
    },
  });

  assert.ok(calledPayload);
  assert.match(calledPayload.text, /Use \/start/);
});
