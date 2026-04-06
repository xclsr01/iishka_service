import { AsyncLocalStorage } from 'node:async_hooks';

export type LogContext = {
  requestId?: string;
  userId?: string;
  telegramUserId?: string;
};

const logContextStorage = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(context: LogContext, callback: () => T): T {
  return logContextStorage.run(context, callback);
}

export function appendLogContext(context: Partial<LogContext>) {
  const current = logContextStorage.getStore() ?? {};
  Object.assign(current, context);
}

export function getLogContext() {
  return logContextStorage.getStore() ?? {};
}
