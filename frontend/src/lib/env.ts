function parseBoolean(value: unknown) {
  if (typeof value !== 'string') {
    return false;
  }

  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
}

export const clientEnv = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787',
  enableDevAuth:
    parseBoolean(import.meta.env.VITE_ENABLE_DEV_AUTH) ||
    (import.meta.env.DEV && Boolean(import.meta.env.VITE_DEV_AUTH_SHARED_SECRET)),
  devAuthSharedSecret: import.meta.env.VITE_DEV_AUTH_SHARED_SECRET ?? '',
};
