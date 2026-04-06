import { logger } from '../../lib/logger';
import type { EnqueueGenerationJobInput } from './jobs-types';

export interface GenerationJobQueue {
  enqueue(input: EnqueueGenerationJobInput): Promise<void>;
}

class LoggingGenerationJobQueue implements GenerationJobQueue {
  async enqueue(input: EnqueueGenerationJobInput) {
    logger.info('generation_job_enqueue_requested', {
      jobId: input.jobId,
      providerKey: input.providerKey,
      kind: input.kind,
      chatId: input.chatId ?? null,
    });
  }
}

export const generationJobQueue: GenerationJobQueue = new LoggingGenerationJobQueue();
