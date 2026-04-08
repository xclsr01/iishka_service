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

    const task = (async () => {
      const { runGenerationJob } = await import('./jobs-runner');
      await runGenerationJob(input.jobId);
    })().catch((error) => {
      logger.error('generation_job_enqueue_execution_failed', {
        jobId: input.jobId,
        providerKey: input.providerKey,
        kind: input.kind,
        message: error instanceof Error ? error.message : 'unknown',
        stack: error instanceof Error ? error.stack ?? null : null,
      });
    });

    if (options?.schedule) {
      options.schedule(task);
      return;
    }

    queueMicrotask(() => {
      void task;
    });
  }
}

export const generationJobQueue: GenerationJobQueue = new InlineGenerationJobQueue();
