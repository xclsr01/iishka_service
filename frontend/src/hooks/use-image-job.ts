import { useEffect, useRef, useState } from 'react';
import { apiClient, type GenerationJob } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type ImageJobState = {
  job: GenerationJob | null;
  isSubmitting: boolean;
  isPolling: boolean;
  error: string | null;
};

function isTerminalStatus(job: GenerationJob | null) {
  return job?.status === 'COMPLETED' || job?.status === 'FAILED' || job?.status === 'CANCELED';
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
    isSubmitting: false,
    isPolling: false,
    error: null,
  });
  const activeJobIdRef = useRef<string | null>(null);

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
      setState({
        job: response.job,
        isSubmitting: false,
        isPolling: !isTerminalStatus(response.job),
        error: null,
      });
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

  function resetJob() {
    activeJobIdRef.current = null;
    setState({
      job: null,
      isSubmitting: false,
      isPolling: false,
      error: null,
    });
  }

  return {
    ...state,
    createImageJob,
    resetJob,
  };
}
