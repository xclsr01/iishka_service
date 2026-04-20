import { serve } from '@hono/node-server';
import { createApp } from './app';
import { env } from './env';
import { logger } from './lib/logger';

const app = createApp();

serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    logger.info('server_started', {
      host: info.address,
      port: info.port,
      env: env.APP_ENV,
    });
  },
);
