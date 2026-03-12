import test from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionStatus, type Subscription } from '@prisma/client';
import { isSubscriptionActive } from './subscription-service';

function buildSubscription(
  overrides: Partial<Subscription> = {},
): Subscription {
  return {
    id: 'sub_1',
    userId: 'user_1',
    planCode: 'mvp-monthly',
    status: SubscriptionStatus.INACTIVE,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    providerReference: null,
    isAutoRenew: false,
    metadata: null,
    createdAt: new Date('2026-03-13T00:00:00.000Z'),
    updatedAt: new Date('2026-03-13T00:00:00.000Z'),
    ...overrides,
  };
}

test('isSubscriptionActive returns true for active subscriptions with a future end date', () => {
  const subscription = buildSubscription({
    status: SubscriptionStatus.ACTIVE,
    currentPeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  assert.equal(isSubscriptionActive(subscription), true);
});

test('isSubscriptionActive returns false for active subscriptions with a past end date', () => {
  const subscription = buildSubscription({
    status: SubscriptionStatus.ACTIVE,
    currentPeriodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });

  assert.equal(isSubscriptionActive(subscription), false);
});

test('isSubscriptionActive returns true for trialing subscriptions without period end', () => {
  const subscription = buildSubscription({
    status: SubscriptionStatus.TRIALING,
    currentPeriodEnd: null,
  });

  assert.equal(isSubscriptionActive(subscription), true);
});
