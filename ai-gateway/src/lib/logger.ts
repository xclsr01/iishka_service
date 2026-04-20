import { getLogContext } from './request-context';

type LogLevel = 'info' | 'error';

function writeLog(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const payload = {
    timestamp: new Date().toISOString(),
    service: 'ai-gateway',
    level,
    message,
    ...getLogContext(),
    ...(meta ?? {}),
  };

  console[level](JSON.stringify(payload));
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    writeLog('info', message, meta);
  },
  error(message: string, meta?: Record<string, unknown>) {
    writeLog('error', message, meta);
  },
};
