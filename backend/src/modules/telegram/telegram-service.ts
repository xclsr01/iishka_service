import { env } from '../../env';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';

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
    logger.error('telegram_api_request_failed', {
      method,
      status: response.status,
      body: body.slice(0, 500),
    });
    throw new AppError(
      `Telegram API request failed with status ${response.status}${body ? `: ${body}` : ''}`,
      502,
      'TELEGRAM_API_FAILED',
    );
  }

  logger.info('telegram_api_request_completed', {
    method,
    status: response.status,
  });
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

function canSendTelegramWebAppButton() {
  return hasUsablePublicMiniAppUrl(resolveMiniAppUrl());
}

async function setMiniAppMenuButton(input?: { chatId?: number }) {
  const miniAppUrl = resolveMiniAppUrl();

  if (!canSendTelegramWebAppButton()) {
    logger.info('telegram_menu_button_skipped', {
      reason: 'invalid_mini_app_url',
      chatScoped: Boolean(input?.chatId),
    });
    return;
  }

  await callTelegram('setChatMenuButton', {
    ...(input?.chatId ? { chat_id: input.chatId } : {}),
    menu_button: {
      type: 'web_app',
      text: 'Open',
      web_app: {
        url: miniAppUrl,
      },
    },
  });
}

export async function configureDefaultMiniAppMenuButton() {
  try {
    await setMiniAppMenuButton();
    logger.info('telegram_default_menu_button_configured');
  } catch (error) {
    logger.error('telegram_default_menu_button_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function sendWelcomeMessage(chatId: number, firstName?: string) {
  const intro = firstName ? `Hi ${firstName}.` : 'Hi.';
  const miniAppUrl = resolveMiniAppUrl();

  if (!canSendTelegramWebAppButton()) {
    logger.error('telegram_welcome_without_web_app_button', {
      reason: 'invalid_mini_app_url',
      miniAppUrlConfigured: Boolean(env.TELEGRAM_MINI_APP_URL),
      frontendUrlConfigured: Boolean(env.FRONTEND_URL),
    });
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

  logger.info('telegram_welcome_sending', {
    hasFirstName: Boolean(firstName),
    miniAppUrlHost: new URL(miniAppUrl).hostname,
  });

  try {
    await setMiniAppMenuButton({ chatId });
  } catch (error) {
    logger.error('telegram_chat_menu_button_failed', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
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
        ],
      ],
    },
  });
}

async function sendHelpMessage(chatId: number) {
  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: 'Use /start to open the Mini App entrypoint.',
  });
}

export async function handleTelegramWebhook(update: TelegramUpdate) {
  const message = update.message;
  if (!message?.text) {
    logger.info('telegram_update_ignored', {
      reason: 'missing_text_message',
    });
    return;
  }

  if (message.text.startsWith('/start')) {
    logger.info('telegram_start_received', {
      hasFirstName: Boolean(message.from?.first_name),
    });
    await sendWelcomeMessage(message.chat.id, message.from?.first_name);
    return;
  }

  logger.info('telegram_help_received');
  await sendHelpMessage(message.chat.id);
}
