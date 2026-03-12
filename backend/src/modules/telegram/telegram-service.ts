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
    throw new AppError('Telegram API request failed', 502, 'TELEGRAM_API_FAILED');
  }
}

async function sendWelcomeMessage(chatId: number, firstName?: string) {
  const intro = firstName ? `Hi ${firstName}.` : 'Hi.';
  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: `${intro} Open the Mini App to browse providers, manage subscription state, and continue your chats.`,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: 'Open Mini App',
            web_app: {
              url: env.TELEGRAM_MINI_APP_URL,
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
    return;
  }

  if (message.text.startsWith('/start')) {
    await sendWelcomeMessage(message.chat.id, message.from?.first_name);
    return;
  }

  await sendHelpMessage(message.chat.id);
}
