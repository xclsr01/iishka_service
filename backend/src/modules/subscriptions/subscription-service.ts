import { SubscriptionStatus, type Subscription } from '@prisma/client';
import { env } from '../../env';
import { AppError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';

const ACTIVE_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
];

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
      currentPeriodStart: now,
      currentPeriodEnd: nextMonth,
      isAutoRenew: false,
      metadata: {
        source: 'dev-override',
      },
    },
  });
}
