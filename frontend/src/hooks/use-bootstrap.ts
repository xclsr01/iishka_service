import { useEffect, useState } from 'react';
import { apiClient, type BootstrapResponse } from '@/lib/api';
import { clientEnv } from '@/lib/env';
import { prepareTelegramChrome } from '@/lib/telegram';

type BootstrapState = {
  data: BootstrapResponse | null;
  error: string | null;
  isLoading: boolean;
};

const STANDALONE_BROWSER_ERROR =
  'This Mini App is live, but Telegram session data is only available when you open it from the bot.';
const BOOTSTRAP_CACHE_KEY = `iishka.bootstrap-cache.v1.${clientEnv.apiBaseUrl}`;

type CachedBootstrap = {
  data: BootstrapResponse;
  cachedAt: number;
};

export const bootstrapErrors = {
  standaloneBrowser: STANDALONE_BROWSER_ERROR,
} as const;

function readCachedBootstrap(): BootstrapResponse | null {
  try {
    const raw = localStorage.getItem(BOOTSTRAP_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CachedBootstrap;
    const data = parsed?.data ?? null;
    if (data?.token) {
      apiClient.setToken(data.token);
    }

    return data;
  } catch {
    return null;
  }
}

function writeCachedBootstrap(data: BootstrapResponse) {
  try {
    localStorage.setItem(
      BOOTSTRAP_CACHE_KEY,
      JSON.stringify({
        data,
        cachedAt: Date.now(),
      } satisfies CachedBootstrap),
    );
  } catch {
    // Ignore cache persistence failures.
  }
}

export function useBootstrap() {
  const [state, setState] = useState<BootstrapState>(() => {
    const cachedData = readCachedBootstrap();
    return {
      data: cachedData,
      error: null,
      isLoading: !cachedData,
    };
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
          throw new Error(STANDALONE_BROWSER_ERROR);
        }

        apiClient.setToken(response.token);
        writeCachedBootstrap(response);

        if (!cancelled) {
          setState({
            data: response,
            error: null,
            isLoading: false,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            data: current.data,
            error: current.data ? null : error instanceof Error ? error.message : 'Bootstrap failed',
            isLoading: false,
          }));
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
