import './load-local-env';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { env } from './env';
import { logger } from './lib/logger';
import { startGenerationJobWorkerLoop } from './modules/jobs/jobs-runner';

const abortController = new AbortController();
const healthApp = new Hono();

healthApp.get('/health', (context) =>
  context.json({
    status: 'ok',
    role: 'generation-job-worker',
    queueDriver: env.JOB_QUEUE_DRIVER,
  }),
);

healthApp.get('/ready', (context) =>
  context.json({
    status: abortController.signal.aborted ? 'stopping' : 'ready',
    role: 'generation-job-worker',
  }),
);

const server = serve(
  {
    fetch: healthApp.fetch,
    port: env.PORT,
  },
  (info) => {
    logger.info('generation_job_worker_health_server_started', {
      host: info.address,
      port: info.port,
    });
  },
);

for (const signalName of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signalName, () => {
    logger.info('generation_job_worker_shutdown_requested', { signalName });
    abortController.abort();
    server.close();
  });
}

void startGenerationJobWorkerLoop({
  claimOwner: env.JOB_WORKER_CLAIM_OWNER,
  pollIntervalMs: env.JOB_WORKER_POLL_INTERVAL_MS,
  batchSize: env.JOB_WORKER_BATCH_SIZE,
  signal: abortController.signal,
}).catch((error) => {
  logger.error('generation_job_worker_failed', {
    message: error instanceof Error ? error.message : 'unknown',
    stack: error instanceof Error ? (error.stack ?? null) : null,
  });
  process.exitCode = 1;
});
