import { SubscriptionStatus, type Subscription } from '@prisma/client';
import { env } from '../../env';
import { AppError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';

const ACTIVE_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
];

export const SUBSCRIPTION_TOKEN_ALLOWANCE = 1000;

export const TOKEN_COSTS = {
  text: 1,
  image: 10,
  music: 50,
  video: 100,
} as const;

export function getRemainingTokens(subscription: Pick<Subscription, 'tokensAllowed' | 'tokensUsed'>) {
  return Math.max(0, subscription.tokensAllowed - subscription.tokensUsed);
}

export function hasSubscriptionAccess(subscription: Subscription | null) {
  if (!subscription) {
    return false;
  }

  return isSubscriptionActive(subscription) && getRemainingTokens(subscription) > 0;
}

export function presentSubscription(subscription: Subscription) {
  return {
    ...subscription,
    hasAccess: hasSubscriptionAccess(subscription),
    tokensRemaining: getRemainingTokens(subscription),
  };
}

export async function ensureDefaultSubscription(userId: string) {
  const existing = await prisma.subscription.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    return existing;
  }

  return prisma.subscription.create({
    data: {
      userId,
      planCode: 'mvp-monthly',
      status: SubscriptionStatus.INACTIVE,
      tokensAllowed: 0,
      tokensUsed: 0,
      metadata: {
        source: 'bootstrap-default',
      },
    },
  });
}

export async function getCurrentSubscription(userId: string) {
  const subscription = await prisma.subscription.findFirst({
    where: { userId },
    orderBy: [{ currentPeriodEnd: 'desc' }, { createdAt: 'desc' }],
  });

  return subscription ?? ensureDefaultSubscription(userId);
}

export function isSubscriptionActive(subscription: Subscription | null) {
  if (!subscription) {
    return false;
  }

  if (!ACTIVE_STATUSES.includes(subscription.status)) {
    return false;
  }

  if (!subscription.currentPeriodEnd) {
    return subscription.status === SubscriptionStatus.TRIALING;
  }

  return subscription.currentPeriodEnd.getTime() >= Date.now();
}

export async function requireActiveSubscription(userId: string) {
  const subscription = await getCurrentSubscription(userId);

  if (!isSubscriptionActive(subscription)) {
    throw new AppError('Active subscription required', 402, 'SUBSCRIPTION_REQUIRED');
  }

  return subscription;
}

export async function consumeSubscriptionTokens(userId: string, amount: number) {
  if (amount <= 0) {
    throw new AppError('Token amount must be positive', 400, 'INVALID_TOKEN_AMOUNT');
  }

  const subscription = await requireActiveSubscription(userId);
  const remainingTokens = getRemainingTokens(subscription);

  if (remainingTokens < amount) {
    throw new AppError(
      'You are out of tokens. Update your subscription to continue.',
      402,
      'TOKENS_EXHAUSTED',
      {
        tokensRemaining: remainingTokens,
        tokensRequired: amount,
      },
    );
  }

  const result = await prisma.subscription.updateMany({
    where: {
      id: subscription.id,
      tokensUsed: {
        lte: subscription.tokensAllowed - amount,
      },
    },
    data: {
      tokensUsed: {
        increment: amount,
      },
    },
  });

  if (result.count === 0) {
    throw new AppError(
      'You are out of tokens. Update your subscription to continue.',
      402,
      'TOKENS_EXHAUSTED',
    );
  }

  return prisma.subscription.findUniqueOrThrow({
    where: { id: subscription.id },
  });
}

export async function activateDevSubscription(userId: string) {
  if (!env.ENABLE_DEV_SUBSCRIPTION_OVERRIDE) {
    throw new AppError('Dev subscription override disabled', 403, 'FORBIDDEN');
  }

  const now = new Date();
  const nextMonth = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);

  const existing = await getCurrentSubscription(userId);
  return prisma.subscription.update({
    where: { id: existing.id },
    data: {
      status: SubscriptionStatus.ACTIVE,
      tokensAllowed: SUBSCRIPTION_TOKEN_ALLOWANCE,
      tokensUsed: 0,
      currentPeriodStart: now,
      currentPeriodEnd: nextMonth,
      isAutoRenew: false,
      metadata: {
        source: 'dev-override',
      },
    },
  });
}

export async function unsubscribeDevSubscription(userId: string) {
  if (!env.ENABLE_DEV_SUBSCRIPTION_OVERRIDE) {
    throw new AppError('Dev subscription override disabled', 403, 'FORBIDDEN');
  }

  const existing = await getCurrentSubscription(userId);
  return prisma.subscription.update({
    where: { id: existing.id },
    data: {
      status: SubscriptionStatus.INACTIVE,
      tokensAllowed: 0,
      tokensUsed: 0,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      isAutoRenew: false,
      metadata: {
        source: 'dev-unsubscribe',
      },
    },
  });
}
