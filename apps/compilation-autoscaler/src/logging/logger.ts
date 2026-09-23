/**
 * Minimal console-based logger, matching the plain `console.log`/`console.error`
 * style already used by `apps/collab-server` and `apps/compilation-worker`
 * (no logging framework elsewhere in the monorepo to stay consistent with).
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
  debug(message: string): void;
}

export function createLogger(scope: string): Logger {
  const prefix = `[${scope}]`;
  return {
    info: (message) => console.log(`${prefix} ${message}`),
    warn: (message) => console.warn(`${prefix} ${message}`),
    error: (message, error) =>
      console.error(
        `${prefix} ${message}`,
        error instanceof Error ? error.message : (error ?? ''),
      ),
    debug: (message) => {
      if (process.env.AUTOSCALER_DEBUG === 'true')
        console.log(`${prefix} ${message}`);
    },
  };
}
