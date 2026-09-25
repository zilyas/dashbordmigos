import { randomUUID } from "crypto";
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
 * Shape a request-id must have to be trusted: printable ASCII, no whitespace
 * or control characters, capped at 128 characters. A caller-supplied value
 * that fails this is treated as absent rather than repaired or truncated —
 * repairing it would let a hostile value silently become a different value
 * than what the caller thinks they sent, which defeats the whole point of
 * echoing it back for correlation. This also keeps an oversized or
 * control-character value out of a log line and out of a response header.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function sanitizeRequestId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return REQUEST_ID_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * Correlation ID for the in-flight request, stamped onto the headers by
 * `src/proxy.ts`. Returns null outside a request scope (module init, tests,
 * background jobs) — `next/headers` throws there, and a missing ID must never
 * be the reason an error goes unlogged.
 *
 * `src/proxy.ts`'s matcher excludes "api", so for a Route Handler under
 * /api this reads whatever raw `x-request-id` the caller sent (or nothing) —
 * it is NOT proxy-stamped there. Sanitizing on the way out means a hostile
 * inbound value can never reach a log line for those routes, even though
 * those route files are out of scope for this change and can't be edited to
 * call `resolveRequestId()` themselves.
 *
 * Imported dynamically so `next/headers` stays out of the static import graph:
 * this module is pulled in by plain-Node code paths (vitest, scripts) that
 * have no Next request context at all.
 */
export async function getRequestId(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    return sanitizeRequestId((await headers()).get("x-request-id"));
  } catch {
    return null;
  }
}

/**
 * Resolves the correlation ID for an /api/* request: echoes the caller's own
 * `x-request-id` when it passes `sanitizeRequestId`, otherwise mints a fresh
 * one. Echoing is what makes a trace joinable across the caller's system and
 * ours — inventing a new ID when they already sent a good one would break
 * that join. A route handler that wants both a response header and a
 * matching log line must call this itself and pass the result to both,
 * since nothing upstream does it for /api (see `getRequestId` above).
 */
export function resolveRequestId(request: Request): string {
  return sanitizeRequestId(request.headers.get("x-request-id")) ?? randomUUID();
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
