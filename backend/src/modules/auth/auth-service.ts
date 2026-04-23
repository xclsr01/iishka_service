import { AppError } from '../../lib/errors';
import { ProviderStatus } from '@prisma/client';
import { signSession, verifyTelegramInitData } from '../../lib/auth';
import { prisma } from '../../lib/prisma';
import { env } from '../../env';
import { ensureRegisteredProvidersSeeded } from '../providers/provider-catalog-sync';
import { presentProviders } from '../providers/provider-presentation';
import {
  ensureDefaultSubscription,
  getCurrentSubscription,
  presentSubscription,
} from '../subscriptions/subscription-service';

export async function bootstrapTelegramUser(initDataRaw: string) {
  const telegramUser = verifyTelegramInitData(
    initDataRaw,
    env.TELEGRAM_BOT_TOKEN,
    env.TELEGRAM_INIT_DATA_TTL_SECONDS,
  );

  const user = await prisma.user.upsert({
    where: {
      telegramUserId: String(telegramUser.id),
    },
    update: {
      telegramUsername: telegramUser.username ?? null,
      firstName: telegramUser.first_name ?? null,
      lastName: telegramUser.last_name ?? null,
      languageCode: telegramUser.language_code ?? null,
      avatarUrl: telegramUser.photo_url ?? null,
    },
    create: {
      telegramUserId: String(telegramUser.id),
      telegramUsername: telegramUser.username ?? null,
      firstName: telegramUser.first_name ?? null,
      lastName: telegramUser.last_name ?? null,
      languageCode: telegramUser.language_code ?? null,
      avatarUrl: telegramUser.photo_url ?? null,
    },
  });

  await ensureDefaultSubscription(user.id);
  await ensureRegisteredProvidersSeeded();
  const subscription = await getCurrentSubscription(user.id);
  const providers = await prisma.provider.findMany({
    where: { status: ProviderStatus.ACTIVE },
    orderBy: { name: 'asc' },
  });

  const token = signSession(
    {
      sub: user.id,
      telegramUserId: user.telegramUserId,
      username: user.telegramUsername,
    },
    env.JWT_SECRET,
    env.SESSION_TTL_MINUTES,
  );

  return {
    token,
    user,
    providers: presentProviders(providers),
    subscription: presentSubscription(subscription),
  };
}

export async function bootstrapDevUser(sharedSecret: string) {
  if (!env.ENABLE_DEV_AUTH) {
    throw new AppError('Dev auth is disabled', 403, 'FORBIDDEN');
  }

  if (!env.DEV_AUTH_SHARED_SECRET) {
    throw new AppError(
      'DEV_AUTH_SHARED_SECRET is not configured on the backend',
      500,
      'DEV_AUTH_NOT_CONFIGURED',
    );
  }

  if (sharedSecret !== env.DEV_AUTH_SHARED_SECRET) {
    throw new AppError('Invalid dev auth', 401, 'UNAUTHORIZED');
  }

  const user = await prisma.user.upsert({
    where: {
      telegramUserId: 'dev-user',
    },
    update: {
      telegramUsername: 'local_dev',
      firstName: 'Local',
      lastName: 'Developer',
    },
    create: {
      telegramUserId: 'dev-user',
      telegramUsername: 'local_dev',
      firstName: 'Local',
      lastName: 'Developer',
      languageCode: 'en',
    },
  });

  await ensureDefaultSubscription(user.id);
  await ensureRegisteredProvidersSeeded();
  const subscription = await getCurrentSubscription(user.id);
  const providers = await prisma.provider.findMany({
    where: { status: ProviderStatus.ACTIVE },
    orderBy: { name: 'asc' },
  });

  const token = signSession(
    {
      sub: user.id,
      telegramUserId: user.telegramUserId,
      username: user.telegramUsername,
    },
    env.JWT_SECRET,
    env.SESSION_TTL_MINUTES,
  );

  return {
    token,
    user,
    providers: presentProviders(providers),
    subscription: presentSubscription(subscription),
  };
}
