export const clientEnv = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787',
  enableDevAuth: import.meta.env.VITE_ENABLE_DEV_AUTH === 'true',
  devAuthSharedSecret: import.meta.env.VITE_DEV_AUTH_SHARED_SECRET ?? '',
};
