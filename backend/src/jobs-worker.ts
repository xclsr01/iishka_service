import './load-local-env';
import { env } from './env';
import { logger } from './lib/logger';
import { startGenerationJobWorkerLoop } from './modules/jobs/jobs-runner';

const abortController = new AbortController();

for (const signalName of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signalName, () => {
    logger.info('generation_job_worker_shutdown_requested', { signalName });
    abortController.abort();
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
