export type FriendlyErrorKey =
  | 'errorGeneric'
  | 'errorSessionExpired'
  | 'errorSubscriptionRequired'
  | 'errorProviderBusy'
  | 'errorProviderTimeout'
  | 'errorProviderFailed'
  | 'errorNetwork'
  | 'errorFileTooLarge'
  | 'errorUnsupportedFile'
  | 'errorNotFound';

type Translate = (key: string) => string;

const DEFAULT_MESSAGES: Record<FriendlyErrorKey, string> = {
  errorGeneric: 'Something went wrong. Please try again.',
  errorSessionExpired: 'Your session expired. Reopen the Mini App and try again.',
  errorSubscriptionRequired: 'Your subscription needs attention before this action can continue.',
  errorProviderBusy: 'The AI provider is busy right now. Please try again in a moment.',
  errorProviderTimeout: 'The AI provider took too long to respond. Please try again.',
  errorProviderFailed: 'The AI provider could not complete this request. Please try again.',
  errorNetwork: 'Network connection failed. Check your connection and try again.',
  errorFileTooLarge: 'This file is too large to upload.',
  errorUnsupportedFile: 'This file type is not supported.',
  errorNotFound: 'This item is no longer available.',
};

const FRIENDLY_ERROR_HINTS: Array<{ pattern: RegExp; key: FriendlyErrorKey }> = [
  {
    pattern: /auth session is not ready|unauthorized|invalid token|expired/i,
    key: 'errorSessionExpired',
  },
  {
    pattern: /out of tokens|active subscription required|subscription/i,
    key: 'errorSubscriptionRequired',
  },
  {
    pattern: /provider is currently busy|provider_rate_limited|rate limit|quota|429/i,
    key: 'errorProviderBusy',
  },
  {
    pattern: /provider request timed out|provider_timeout|timed out|timeout/i,
    key: 'errorProviderTimeout',
  },
  {
    pattern: /provider request failed|provider_bad_request|provider_request_failed|internal_error|upstream|bad request|internal server error|transaction api/i,
    key: 'errorProviderFailed',
  },
  {
    pattern: /failed to fetch|networkerror|load failed|network/i,
    key: 'errorNetwork',
  },
  {
    pattern: /file too large|file_too_large/i,
    key: 'errorFileTooLarge',
  },
  {
    pattern: /unsupported file type|unsupported_file_type/i,
    key: 'errorUnsupportedFile',
  },
  {
    pattern: /not found|not_found/i,
    key: 'errorNotFound',
  },
];

export class FriendlyError extends Error {
  readonly friendlyKey: FriendlyErrorKey | null;
  readonly rawMessage: string;

  constructor(rawMessage: string, friendlyKey: FriendlyErrorKey | null) {
    super(friendlyKey ? DEFAULT_MESSAGES[friendlyKey] : rawMessage);
    this.name = 'FriendlyError';
    this.friendlyKey = friendlyKey;
    this.rawMessage = rawMessage;
  }
}

function normalizeMessage(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function looksTechnical(message: string) {
  return (
    message.length > 160 ||
    / at file:\/\/|stack|trace|prisma|transaction api|supabase|violates row-level security|jwt|token=|eyJ|<html|{.*}/i.test(message)
  );
}

export function getFriendlyErrorKey(error: unknown): FriendlyErrorKey | null {
  if (error instanceof FriendlyError) {
    return error.friendlyKey;
  }

  const rawMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const message = normalizeMessage(rawMessage);
  if (!message) {
    return null;
  }

  return FRIENDLY_ERROR_HINTS.find((hint) => hint.pattern.test(message))?.key ?? null;
}

export function createFriendlyError(error: unknown, fallbackKey: FriendlyErrorKey = 'errorGeneric') {
  const rawMessage = normalizeMessage(
    error instanceof Error ? error.message : typeof error === 'string' ? error : '',
  );
  const key = getFriendlyErrorKey(rawMessage) ?? (rawMessage ? null : fallbackKey);
  return new FriendlyError(rawMessage || DEFAULT_MESSAGES[fallbackKey], key);
}

export function toFriendlyErrorMessage(
  error: unknown,
  translateOrFallback?: Translate | string,
  fallback = DEFAULT_MESSAGES.errorGeneric,
) {
  const translate = typeof translateOrFallback === 'function' ? translateOrFallback : null;
  const stringFallback = typeof translateOrFallback === 'string' ? translateOrFallback : fallback;
  const key = getFriendlyErrorKey(error);
  if (key) {
    return translate ? translate(key) : DEFAULT_MESSAGES[key];
  }

  const rawMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const message = normalizeMessage(rawMessage);
  if (!message || looksTechnical(message)) {
    return stringFallback;
  }

  return message;
}
