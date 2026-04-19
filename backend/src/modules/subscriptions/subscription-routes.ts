import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import type { AppVariables } from '../../types';
import {
  activateDevSubscription,
  getCurrentSubscription,
  presentSubscription,
  unsubscribeDevSubscription,
} from './subscription-service';

export const subscriptionRoutes = new Hono<{ Variables: AppVariables }>();

subscriptionRoutes.use('*', authMiddleware);

subscriptionRoutes.get('/', async (c) => {
  const session = c.get('authSession');
  const subscription = await getCurrentSubscription(session.userId);

  return c.json({
    subscription: presentSubscription(subscription),
  });
});

subscriptionRoutes.post('/dev/activate', async (c) => {
  const session = c.get('authSession');
  const subscription = await activateDevSubscription(session.userId);

  return c.json({
    subscription: presentSubscription(subscription),
  });
});

subscriptionRoutes.post('/dev/unsubscribe', async (c) => {
  const session = c.get('authSession');
  const subscription = await unsubscribeDevSubscription(session.userId);

  return c.json({
    subscription: presentSubscription(subscription),
  });
});
