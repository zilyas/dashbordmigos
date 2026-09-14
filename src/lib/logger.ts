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

/**
 * Correlation ID for the in-flight request, stamped onto the headers by
 * `src/proxy.ts`. Returns null outside a request scope (module init, tests,
 * background jobs) — `next/headers` throws there, and a missing ID must never
 * be the reason an error goes unlogged.
 *
 * Imported dynamically so `next/headers` stays out of the static import graph:
 * this module is pulled in by plain-Node code paths (vitest, scripts) that
 * have no Next request context at all.
 */
export async function getRequestId(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    return (await headers()).get("x-request-id");
  } catch {
    return null;
  }
}

/**
 * Shared helper for Server Action / Route Handler catch blocks. Async because
 * it resolves the request correlation ID — await it so every line of one
 * request's logs can be grouped by `requestId`.
 */
export async function logServerError(scope: LogScope, error: unknown, context?: Record<string, unknown>) {
  const requestId = await getRequestId();
  scopedLogger(scope).error(
    { err: error, ...(requestId ? { requestId } : {}), ...context },
    error instanceof Error ? error.message : "Unexpected error"
  );
}
