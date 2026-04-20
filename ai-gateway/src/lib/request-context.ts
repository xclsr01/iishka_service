import { AsyncLocalStorage } from 'node:async_hooks';

export type LogContext = {
  requestId?: string;
};

const storage = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(context: LogContext, callback: () => T): T {
  return storage.run(context, callback);
}

export function appendLogContext(context: Partial<LogContext>) {
  const current = storage.getStore() ?? {};
  Object.assign(current, context);
}

export function getLogContext() {
  return storage.getStore() ?? {};
}
