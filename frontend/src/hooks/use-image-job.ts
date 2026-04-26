import { useEffect, useRef, useState } from 'react';
import { apiClient, type GenerationJob } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

const IMAGE_HISTORY_LIMIT = 100;
const IMAGE_HISTORY_DETAIL_LIMIT = 20;

type ImageJobState = {
  job: GenerationJob | null;
  jobs: GenerationJob[];
  isLoadingHistory: boolean;
  isSubmitting: boolean;
  isPolling: boolean;
  error: string | null;
};

function isTerminalStatus(job: GenerationJob | null) {
  return job?.status === 'COMPLETED' || job?.status === 'FAILED' || job?.status === 'CANCELED';
}

function shouldHydrateHistoryJob(job: GenerationJob) {
  return job.status === 'COMPLETED' && !job.resultPayload;
}

function toUserFacingError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export function useImageJob(providerId: string) {
  const { t } = useLocale();
  const [state, setState] = useState<ImageJobState>({
    job: null,
    jobs: [],
    isLoadingHistory: true,
    isSubmitting: false,
    isPolling: false,
    error: null,
  });
  const activeJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      try {
        const response = await apiClient.getGenerationJobs({
          providerId,
          kind: 'IMAGE',
          limit: IMAGE_HISTORY_LIMIT,
        });
        if (cancelled) {
          return;
        }

        const imageJobs = response.jobs.filter((job) => job.kind === 'IMAGE' && job.provider.id === providerId);
        const activeJob = imageJobs.find((historyJob) => !isTerminalStatus(historyJob)) ?? null;
        activeJobIdRef.current = activeJob?.id ?? null;

        setState((current) => ({
          ...current,
          job: activeJob,
          jobs: imageJobs,
          isLoadingHistory: false,
          isPolling: Boolean(activeJob),
          error: null,
        }));

        const jobsToHydrate = imageJobs.filter(shouldHydrateHistoryJob).slice(0, IMAGE_HISTORY_DETAIL_LIMIT);
        if (jobsToHydrate.length === 0) {
          return;
        }

        const hydratedJobs = await Promise.all(
          jobsToHydrate.map(async (historyJob) => {
            try {
              return (await apiClient.getGenerationJob(historyJob.id)).job;
            } catch {
              return historyJob;
            }
          }),
        );

        if (cancelled) {
          return;
        }

        const hydratedJobById = new Map(hydratedJobs.map((historyJob) => [historyJob.id, historyJob]));
        setState((current) => ({
          ...current,
          job: current.job ? hydratedJobById.get(current.job.id) ?? current.job : current.job,
          jobs: current.jobs.map((historyJob) => hydratedJobById.get(historyJob.id) ?? historyJob),
        }));
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            isLoadingHistory: false,
            error: current.job || current.jobs.length > 0
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

  useEffect(() => {
    if (!state.job || isTerminalStatus(state.job)) {
      setState((current) => (current.isPolling ? { ...current, isPolling: false } : current));
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

        setState((current) => ({
          ...current,
          job: response.job,
          jobs: current.jobs.map((job) => (job.id === response.job.id ? response.job : job)),
          isPolling: !isTerminalStatus(response.job),
          error: response.job.status === 'FAILED'
            ? response.job.failureMessage || t('imageGenerationFailed')
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
    try {
      setState((current) => ({
        ...current,
        isSubmitting: true,
        error: null,
      }));

      const response = await apiClient.createGenerationJob({
        providerId,
        kind: 'IMAGE',
        prompt,
      });

      activeJobIdRef.current = response.job.id;
      setState((current) => ({
        ...current,
        job: response.job,
        jobs: [response.job, ...current.jobs.filter((job) => job.id !== response.job.id)],
        isLoadingHistory: false,
        isSubmitting: false,
        isPolling: !isTerminalStatus(response.job),
        error: null,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        isSubmitting: false,
        isPolling: false,
        error: toUserFacingError(error, t('imageGenerationFailed')),
      }));
      throw error;
    }
  }

  function removeImageJob(jobId: string) {
    activeJobIdRef.current = activeJobIdRef.current === jobId ? null : activeJobIdRef.current;
    setState((current) => {
      const nextJobs = current.jobs.filter((job) => job.id !== jobId);
      const nextActiveJob = current.job?.id === jobId
        ? nextJobs.find((job) => !isTerminalStatus(job)) ?? null
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
    removeImageJob,
    resetJob,
  };
}
