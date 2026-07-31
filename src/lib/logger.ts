import pino from "pino";

/**
 * Structured JSON logger, written to stdout — Coolify (and any container
 * platform) captures stdout natively, so this needs no external shipper.
 * Node runtime only: never import this from `proxy.ts`, `auth.config.ts`,
 * or anything else that has to run on the edge runtime.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: { err: pino.stdSerializers.err },
});

export type LogScope = "app" | "auth" | "error" | "db" | "system";

export function scopedLogger(scope: LogScope) {
  return logger.child({ scope });
}

/** Shared helper for Server Action / Route Handler catch blocks. */
export function logServerError(scope: LogScope, error: unknown, context?: Record<string, unknown>) {
  scopedLogger(scope).error(
    { err: error, ...context },
    error instanceof Error ? error.message : "Unexpected error"
  );
}
