import { logger } from '../../lib/logger';
import type { EnqueueGenerationJobInput, EnqueueGenerationJobOptions } from './jobs-types';

export interface GenerationJobQueue {
  enqueue(input: EnqueueGenerationJobInput, options?: EnqueueGenerationJobOptions): Promise<void>;
}

class InlineGenerationJobQueue implements GenerationJobQueue {
  async enqueue(input: EnqueueGenerationJobInput, options?: EnqueueGenerationJobOptions) {
    logger.info('generation_job_enqueue_requested', {
      jobId: input.jobId,
      providerKey: input.providerKey,
      kind: input.kind,
      chatId: input.chatId ?? null,
    });

    const createTask = () =>
      (async () => {
        try {
          const { runGenerationJob } = await import('./jobs-runner.js');
          await runGenerationJob(input.jobId);
        } catch (error) {
          logger.error('generation_job_enqueue_execution_failed', {
            jobId: input.jobId,
            providerKey: input.providerKey,
            kind: input.kind,
            message: error instanceof Error ? error.message : 'unknown',
            stack: error instanceof Error ? error.stack ?? null : null,
          });
        } finally {
          await options?.onSettled?.().catch((error) => {
            logger.error('generation_job_enqueue_cleanup_failed', {
              jobId: input.jobId,
              providerKey: input.providerKey,
              kind: input.kind,
              message: error instanceof Error ? error.message : 'unknown',
              stack: error instanceof Error ? error.stack ?? null : null,
            });
          });
        }
      })();

    if (options?.schedule) {
      options.schedule(createTask());
      return;
    }

    // Cloud Run does not provide Worker-style waitUntil, and request-scoped CPU can be
    // throttled after the response. Run inline until a real queue worker is introduced.
    await createTask();
  }
}

export const generationJobQueue: GenerationJobQueue = new InlineGenerationJobQueue();
