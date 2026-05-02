import { useEffect, useRef, useState } from 'react';
import { apiClient, type GenerationJob, type Provider } from '@/lib/api';
import { createIdempotencyKey } from '@/lib/idempotency';
import { useLocale } from '@/lib/i18n';

const IMAGE_HISTORY_PAGE_SIZE = 10;

type ImageJobState = {
  job: GenerationJob | null;
  jobs: GenerationJob[];
  isLoadingHistory: boolean;
  isLoadingMore: boolean;
  isSubmitting: boolean;
  isPolling: boolean;
  nextCursor: string | null;
  error: string | null;
};

function isTerminalStatus(job: GenerationJob | null) {
  return (
    job?.status === 'COMPLETED' ||
    job?.status === 'FAILED' ||
    job?.status === 'CANCELED'
  );
}

function hasRenderableImagePayload(job: GenerationJob) {
  if (!job.resultPayload || typeof job.resultPayload !== 'object') {
    return false;
  }

  const payload = job.resultPayload as { kind?: unknown; images?: unknown };
  if (payload.kind !== 'IMAGE' || !Array.isArray(payload.images)) {
    return false;
  }

  return payload.images.some((image) => {
    if (!image || typeof image !== 'object') {
      return false;
    }

    const candidate = image as { dataBase64?: unknown; mimeType?: unknown };
    return (
      typeof candidate.dataBase64 === 'string' &&
      candidate.dataBase64.length > 0 &&
      typeof candidate.mimeType === 'string' &&
      candidate.mimeType.length > 0
    );
  });
}

function shouldHydrateHistoryJob(job: GenerationJob) {
  return job.status === 'COMPLETED' && !hasRenderableImagePayload(job);
}

function isOptimisticJob(job: GenerationJob | null) {
  return Boolean(job?.id.startsWith('optimistic-image-'));
}

function toUserFacingError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function buildOptimisticImageJob(
  provider: Provider,
  prompt: string,
): GenerationJob {
  const now = new Date().toISOString();

  return {
    id: `optimistic-image-${crypto.randomUUID()}`,
    kind: 'IMAGE',
    status: 'QUEUED',
    prompt,
    failureCode: null,
    failureMessage: null,
    externalJobId: null,
    providerRequestId: null,
    attemptCount: 0,
    queuedAt: now,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    chatId: null,
    messageId: null,
    provider: {
      id: provider.id,
      key: provider.key,
      name: provider.name,
      slug: provider.slug,
      defaultModel: provider.defaultModel,
    },
    resultPayload: null,
  };
}

export function useImageJob(provider: Provider) {
  const { t } = useLocale();
  const providerId = provider.id;
  const [state, setState] = useState<ImageJobState>({
    job: null,
    jobs: [],
    isLoadingHistory: true,
    isLoadingMore: false,
    isSubmitting: false,
    isPolling: false,
    nextCursor: null,
    error: null,
  });
  const activeJobIdRef = useRef<string | null>(null);

  async function hydrateCompletedImageJob(job: GenerationJob) {
    if (!shouldHydrateHistoryJob(job)) {
      return job;
    }

    try {
      return (await apiClient.getGenerationJob(job.id)).job;
    } catch {
      return job;
    }
  }

  async function hydrateHistoryJobs(jobs: GenerationJob[]) {
    const jobsToHydrate = jobs.filter(shouldHydrateHistoryJob);
    if (jobsToHydrate.length === 0) {
      return jobs;
    }

    const hydratedJobs = await Promise.all(
      jobsToHydrate.map((historyJob) => hydrateCompletedImageJob(historyJob)),
    );
    const hydratedJobById = new Map(
      hydratedJobs.map((historyJob) => [historyJob.id, historyJob]),
    );

    return jobs.map(
      (historyJob) => hydratedJobById.get(historyJob.id) ?? historyJob,
    );
  }

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      try {
        const response = await apiClient.getGenerationJobs({
          providerId,
          kind: 'IMAGE',
          limit: IMAGE_HISTORY_PAGE_SIZE,
        });
        if (cancelled) {
          return;
        }

        const imageJobs = await hydrateHistoryJobs(
          response.jobs.filter(
            (job) => job.kind === 'IMAGE' && job.provider.id === providerId,
          ),
        );
        if (cancelled) {
          return;
        }

        const activeJob =
          imageJobs.find((historyJob) => !isTerminalStatus(historyJob)) ?? null;
        activeJobIdRef.current = activeJob?.id ?? null;

        setState((current) => ({
          ...current,
          job: activeJob,
          jobs: imageJobs,
          nextCursor: response.nextCursor,
          isLoadingHistory: false,
          isPolling: Boolean(activeJob),
          error: null,
        }));
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            isLoadingHistory: false,
            error:
              current.job || current.jobs.length > 0
                ? current.error
                : toUserFacingError(error, t('imageGenerationFailed')),
          }));
        }
      }
    }

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [providerId, t]);

  async function loadMoreHistory() {
    const cursor = state.nextCursor;
    if (!cursor || state.isLoadingHistory || state.isLoadingMore) {
      return;
    }

    try {
      setState((current) => ({
        ...current,
        isLoadingMore: true,
        error: null,
      }));

      const response = await apiClient.getGenerationJobs({
        providerId,
        kind: 'IMAGE',
        limit: IMAGE_HISTORY_PAGE_SIZE,
        cursor,
      });
      const imageJobs = await hydrateHistoryJobs(
        response.jobs.filter(
          (job) => job.kind === 'IMAGE' && job.provider.id === providerId,
        ),
      );

      setState((current) => {
        const existingJobIds = new Set(
          current.jobs.map((historyJob) => historyJob.id),
        );
        const nextJobs = [
          ...current.jobs,
          ...imageJobs.filter(
            (historyJob) => !existingJobIds.has(historyJob.id),
          ),
        ];
        const nextActiveJob =
          current.job ??
          nextJobs.find((historyJob) => !isTerminalStatus(historyJob)) ??
          null;

        activeJobIdRef.current = nextActiveJob?.id ?? activeJobIdRef.current;

        return {
          ...current,
          job: nextActiveJob,
          jobs: nextJobs,
          nextCursor: response.nextCursor,
          isLoadingMore: false,
          isPolling:
            current.isPolling ||
            Boolean(nextActiveJob && !isTerminalStatus(nextActiveJob)),
          error: null,
        };
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        isLoadingMore: false,
        error: toUserFacingError(error, t('imageGenerationFailed')),
      }));
    }
  }

  useEffect(() => {
    if (
      !state.job ||
      isOptimisticJob(state.job) ||
      isTerminalStatus(state.job)
    ) {
      setState((current) =>
        current.isPolling ? { ...current, isPolling: false } : current,
      );
      return;
    }

    let cancelled = false;
    const jobId = state.job.id;
    activeJobIdRef.current = jobId;

    async function poll() {
      try {
        const response = await apiClient.getGenerationJob(jobId);
        if (cancelled || activeJobIdRef.current !== jobId) {
          return;
        }

        const nextJob = await hydrateCompletedImageJob(response.job);
        if (cancelled || activeJobIdRef.current !== jobId) {
          return;
        }

        setState((current) => ({
          ...current,
          job: nextJob,
          jobs: current.jobs.map((job) =>
            job.id === nextJob.id ? nextJob : job,
          ),
          isPolling: !isTerminalStatus(nextJob),
          error:
            nextJob.status === 'FAILED'
              ? nextJob.failureMessage || t('imageGenerationFailed')
              : null,
        }));
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            isPolling: false,
            error: toUserFacingError(error, t('imageGenerationFailed')),
          }));
        }
      }
    }

    const intervalId = window.setInterval(() => {
      void poll();
    }, 1500);
    void poll();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [state.job?.id, state.job?.status, t]);

  async function createImageJob(prompt: string) {
    const optimisticJob = buildOptimisticImageJob(provider, prompt);

    try {
      setState((current) => ({
        ...current,
        job: optimisticJob,
        jobs: [optimisticJob, ...current.jobs],
        isSubmitting: true,
        isLoadingHistory: false,
        isPolling: true,
        error: null,
      }));

      const response = await apiClient.createGenerationJob({
        providerId,
        kind: 'IMAGE',
        prompt,
        idempotencyKey: createIdempotencyKey('generation-job-create'),
      });

      const createdJob = await hydrateCompletedImageJob(response.job);

      activeJobIdRef.current = createdJob.id;
      setState((current) => ({
        ...current,
        job: createdJob,
        jobs: [
          createdJob,
          ...current.jobs.filter(
            (job) => job.id !== createdJob.id && job.id !== optimisticJob.id,
          ),
        ],
        isLoadingHistory: false,
        isSubmitting: false,
        isPolling: !isTerminalStatus(createdJob),
        error: null,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        job: current.job?.id === optimisticJob.id ? null : current.job,
        jobs: current.jobs.filter((job) => job.id !== optimisticJob.id),
        isSubmitting: false,
        isPolling: Boolean(
          current.job &&
          current.job.id !== optimisticJob.id &&
          !isTerminalStatus(current.job),
        ),
        error: toUserFacingError(error, t('imageGenerationFailed')),
      }));
      throw error;
    }
  }

  function removeImageJob(jobId: string) {
    activeJobIdRef.current =
      activeJobIdRef.current === jobId ? null : activeJobIdRef.current;
    setState((current) => {
      const nextJobs = current.jobs.filter((job) => job.id !== jobId);
      const nextActiveJob =
        current.job?.id === jobId
          ? (nextJobs.find((job) => !isTerminalStatus(job)) ?? null)
          : current.job;

      return {
        ...current,
        job: nextActiveJob,
        jobs: nextJobs,
        isPolling: Boolean(nextActiveJob && !isTerminalStatus(nextActiveJob)),
        error: current.job?.id === jobId ? null : current.error,
      };
    });
  }

  function resetJob() {
    activeJobIdRef.current = null;
    setState((current) => ({
      ...current,
      job: null,
      isLoadingHistory: false,
      isSubmitting: false,
      isPolling: false,
      error: null,
    }));
  }

  return {
    ...state,
    createImageJob,
    loadMoreHistory,
    removeImageJob,
    resetJob,
  };
}
