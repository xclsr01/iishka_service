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
  const user = c.get('currentUser');
  const subscription = await getCurrentSubscription(user.id);

  return c.json({
    subscription: presentSubscription(subscription),
  });
});

subscriptionRoutes.post('/dev/activate', async (c) => {
  const user = c.get('currentUser');
  const subscription = await activateDevSubscription(user.id);

  return c.json({
    subscription: presentSubscription(subscription),
  });
});

subscriptionRoutes.post('/dev/unsubscribe', async (c) => {
  const user = c.get('currentUser');
  const subscription = await unsubscribeDevSubscription(user.id);

  return c.json({
    subscription: presentSubscription(subscription),
  });
});
