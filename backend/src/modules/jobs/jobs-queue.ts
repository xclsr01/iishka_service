import { logger } from '../../lib/logger';
import type {
  EnqueueGenerationJobInput,
  EnqueueGenerationJobOptions,
} from './jobs-types';

export interface GenerationJobQueue {
  enqueue(
    input: EnqueueGenerationJobInput,
    options?: EnqueueGenerationJobOptions,
  ): Promise<void>;
}

function scheduleBackgroundTask(task: () => Promise<unknown>) {
  setImmediate(() => {
    void task();
  });
}

class InlineGenerationJobQueue implements GenerationJobQueue {
  private providerTails = new Map<string, Promise<void>>();

  async enqueue(
    input: EnqueueGenerationJobInput,
    options?: EnqueueGenerationJobOptions,
  ) {
    logger.info('generation_job_enqueue_requested', {
      jobId: input.jobId,
      providerKey: input.providerKey,
      kind: input.kind,
      chatId: input.chatId ?? null,
    });

    const runTask = async () => {
      try {
        const { runGenerationJob } = await import('./jobs-runner');
        await runGenerationJob(input.jobId);
      } catch (error) {
        logger.error('generation_job_enqueue_execution_failed', {
          jobId: input.jobId,
          providerKey: input.providerKey,
          kind: input.kind,
          message: error instanceof Error ? error.message : 'unknown',
          stack: error instanceof Error ? (error.stack ?? null) : null,
        });
      } finally {
        await options?.onSettled?.().catch((error) => {
          logger.error('generation_job_enqueue_cleanup_failed', {
            jobId: input.jobId,
            providerKey: input.providerKey,
            kind: input.kind,
            message: error instanceof Error ? error.message : 'unknown',
            stack: error instanceof Error ? (error.stack ?? null) : null,
          });
        });
      }
    };

    const providerQueueKey = input.providerKey;
    const previousProviderTask =
      this.providerTails.get(providerQueueKey) ?? Promise.resolve();
    let startTask!: () => void;
    const startGate = new Promise<void>((resolve) => {
      startTask = resolve;
    });
    const queuedTask = previousProviderTask
      .catch(() => undefined)
      .then(() => startGate)
      .then(runTask);

    this.providerTails.set(providerQueueKey, queuedTask);
    queuedTask.finally(() => {
      if (this.providerTails.get(providerQueueKey) === queuedTask) {
        this.providerTails.delete(providerQueueKey);
      }
    });

    (options?.schedule ?? scheduleBackgroundTask)(() => {
      startTask();
      return queuedTask;
    });
  }
}

export const generationJobQueue: GenerationJobQueue =
  new InlineGenerationJobQueue();
