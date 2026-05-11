import type { SemanticReleaseContext } from './types.js';

type LogMethod = (message: string, ...args: unknown[]) => void;

export interface Logger {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  success: LogMethod;
}

export const createLogger = (context?: SemanticReleaseContext): Logger => {
  const fallback = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  const debug: LogMethod = context?.logger?.log?.bind(context.logger) ?? fallback.log;
  const info: LogMethod = context?.logger?.log?.bind(context.logger) ?? fallback.log;
  const warn: LogMethod = context?.logger?.warn?.bind(context.logger) ?? fallback.warn;
  const error: LogMethod = context?.logger?.error?.bind(context.logger) ?? fallback.error;
  const success: LogMethod = (context?.logger as Logger | undefined)?.success?.bind(
    context?.logger,
  ) ?? info;

  return {
    debug,
    info,
    warn,
    error,
    success,
  };
};

export const redact = (value: string | undefined | null): string => {
  if (!value) return '';
  return '***';
};
