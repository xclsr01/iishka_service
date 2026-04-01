import { env } from '../../env';
import { AppError } from '../../lib/errors';

type TelegramUpdate = {
  message?: {
    chat: {
      id: number;
    };
    text?: string;
    from?: {
      first_name?: string;
    };
  };
};

async function callTelegram(method: string, payload: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new AppError(
      `Telegram API request failed with status ${response.status}${body ? `: ${body}` : ''}`,
      502,
      'TELEGRAM_API_FAILED',
    );
  }
}

function hasUsablePublicMiniAppUrl(candidate: string) {
  try {
    const url = new URL(candidate);
    const isPublicHttps = url.protocol === 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname);
    const isTelegramDeepLink = ['t.me', 'telegram.me'].includes(url.hostname);
    return isPublicHttps && !isTelegramDeepLink;
  } catch {
    return false;
  }
}

export function resolveMiniAppUrl() {
  if (hasUsablePublicMiniAppUrl(env.TELEGRAM_MINI_APP_URL)) {
    return env.TELEGRAM_MINI_APP_URL;
  }

  if (env.APP_ENV === 'development') {
    return env.FRONTEND_URL;
  }

  return env.TELEGRAM_MINI_APP_URL;
}

function resolveSubscriptionUrl() {
  const url = new URL(resolveMiniAppUrl());
  url.searchParams.set('section', 'subscription');
  return url.toString();
}

function canSendTelegramWebAppButton() {
  return hasUsablePublicMiniAppUrl(resolveMiniAppUrl());
}

async function sendWelcomeMessage(chatId: number, firstName?: string) {
  const intro = firstName ? `Hi ${firstName}.` : 'Hi.';
  const miniAppUrl = resolveMiniAppUrl();
  const subscriptionUrl = resolveSubscriptionUrl();

  if (!canSendTelegramWebAppButton()) {
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text:
        `${intro} The Mini App is not available through Telegram yet because ` +
        `the configured URL is not a public HTTPS URL. ` +
        `For local development, open ${env.FRONTEND_URL} in your browser. ` +
        `To make the Telegram button work, set TELEGRAM_MINI_APP_URL to a public HTTPS frontend URL.`,
    });
    return;
  }

  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: `${intro} Open the Mini App to browse providers, manage subscription state, and continue your chats.`,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: 'Open Mini App',
            web_app: {
              url: miniAppUrl,
            },
          },
          {
            text: 'Subscription',
            web_app: {
              url: subscriptionUrl,
            },
          },
        ],
      ],
    },
  });
}

async function sendHelpMessage(chatId: number) {
  const miniAppUrl = resolveMiniAppUrl();
  const subscriptionUrl = resolveSubscriptionUrl();

  if (!canSendTelegramWebAppButton()) {
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: 'Use /start to open the Mini App entrypoint.',
    });
    return;
  }

  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: 'Use /start to open the Mini App or jump straight to subscription management.',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: 'Open Mini App',
            web_app: {
              url: miniAppUrl,
            },
          },
          {
            text: 'Subscription',
            web_app: {
              url: subscriptionUrl,
            },
          },
        ],
      ],
    },
  });
}

export async function handleTelegramWebhook(update: TelegramUpdate) {
  const message = update.message;
  if (!message?.text) {
    return;
  }

  if (message.text.startsWith('/start')) {
    await sendWelcomeMessage(message.chat.id, message.from?.first_name);
    return;
  }

  if (message.text.startsWith('/help')) {
    await sendHelpMessage(message.chat.id);
    return;
  }

  await sendHelpMessage(message.chat.id);
}
