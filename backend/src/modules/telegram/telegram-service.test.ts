import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  configureDefaultMiniAppMenuButton,
  handleTelegramWebhook,
  resolveMiniAppUrl,
} from './telegram-service';

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
  const calls: Array<{ url: string; payload: Record<string, unknown> }> = [];

  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      payload: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  await handleTelegramWebhook({
    message: {
      chat: { id: 77 },
      text: '/start',
      from: { first_name: 'Artem' },
    },
  });

  const menuCall = calls.find((call) => /setChatMenuButton$/.test(call.url));
  assert.ok(menuCall);
  assert.equal(menuCall.payload.chat_id, 77);
  assert.deepEqual(menuCall.payload.menu_button, {
    type: 'web_app',
    text: 'Open',
    web_app: {
      url: resolveMiniAppUrl(),
    },
  });

  const messageCall = calls.find((call) => /sendMessage$/.test(call.url));
  assert.ok(messageCall);
  const calledPayload = messageCall.payload as SendMessagePayload;
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

test('configureDefaultMiniAppMenuButton sets a default Open web app button', async () => {
  let calledUrl = '';
  let calledPayload: Record<string, unknown> | null = null;

  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  await configureDefaultMiniAppMenuButton();

  assert.match(calledUrl, /setChatMenuButton$/);
  assert.deepEqual(calledPayload, {
    menu_button: {
      type: 'web_app',
      text: 'Open',
      web_app: {
        url: resolveMiniAppUrl(),
      },
    },
  });
});
