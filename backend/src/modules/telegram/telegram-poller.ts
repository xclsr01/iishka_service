import { env } from '../../env';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/errors';
import { handleTelegramWebhook, resolveMiniAppUrl } from './telegram-service';

type TelegramUpdate = {
  update_id: number;
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

let started = false;

async function telegramRequest<T>(method: string, payload: Record<string, unknown>) {
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
      `Telegram ${method} request failed with status ${response.status}${body ? `: ${body}` : ''}`,
      502,
      'TELEGRAM_API_FAILED',
    );
  }

  return (await response.json()) as T;
}

async function clearWebhook() {
  await telegramRequest('deleteWebhook', {
    drop_pending_updates: false,
  });
}

async function validateBot() {
  return telegramRequest<{
    ok: boolean;
    result?: {
      id: number;
      username?: string;
    };
  }>('getMe', {});
}

async function getUpdates(offset: number) {
  return telegramRequest<{
    ok: boolean;
    result: TelegramUpdate[];
  }>('getUpdates', {
    offset,
    timeout: 25,
    allowed_updates: ['message'],
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startTelegramPolling() {
  if (started || env.TELEGRAM_DELIVERY_MODE !== 'polling') {
    return;
  }

  started = true;

  void (async () => {
    let offset = 0;

    try {
      const bot = await validateBot();
      await clearWebhook();
      logger.info('telegram_polling_started', {
        mode: env.TELEGRAM_DELIVERY_MODE,
        botUsername: bot.result?.username ?? null,
        miniAppUrl: resolveMiniAppUrl(),
      });
    } catch (error) {
      logger.error('telegram_polling_init_failed', {
        message: error instanceof Error ? error.message : 'unknown',
      });
    }

    while (started) {
      try {
        const payload = await getUpdates(offset);

        for (const update of payload.result) {
          offset = update.update_id + 1;
          await handleTelegramWebhook(update);
        }
      } catch (error) {
        logger.error('telegram_polling_failed', {
          message: error instanceof Error ? error.message : 'unknown',
        });
        await sleep(3000);
      }
    }
  })();
}
