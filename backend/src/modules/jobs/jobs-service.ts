import type { GenerationJobInput, QueuedGenerationJob } from './jobs-types';

export function prepareQueuedGenerationJob(input: GenerationJobInput): QueuedGenerationJob {
  return {
    status: 'queued',
    input,
    queuedAt: new Date().toISOString(),
  };
}
