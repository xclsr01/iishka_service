import { useEffect, useState } from 'react';
import { apiClient, type BootstrapResponse } from '@/lib/api';
import { clientEnv } from '@/lib/env';
import { prepareTelegramChrome } from '@/lib/telegram';

type BootstrapState = {
  data: BootstrapResponse | null;
  error: string | null;
  isLoading: boolean;
};

export function useBootstrap() {
  const [state, setState] = useState<BootstrapState>({
    data: null,
    error: null,
    isLoading: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      prepareTelegramChrome();

      try {
        const initDataRaw = window.Telegram?.WebApp?.initData;
        const shouldUseDevAuth =
          clientEnv.enableDevAuth ||
          (window.location.hostname === 'localhost' && clientEnv.devAuthSharedSecret.length > 0);
        const response =
          initDataRaw && initDataRaw.length > 0
            ? await apiClient.bootstrapTelegram(initDataRaw)
            : shouldUseDevAuth
              ? await apiClient.bootstrapDev()
              : null;

        if (!response) {
          throw new Error(
            'Telegram init data is unavailable and local dev auth fallback is not configured',
          );
        }

        apiClient.setToken(response.token);

        if (!cancelled) {
          setState({
            data: response,
            error: null,
            isLoading: false,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            data: null,
            error: error instanceof Error ? error.message : 'Bootstrap failed',
            isLoading: false,
          });
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
