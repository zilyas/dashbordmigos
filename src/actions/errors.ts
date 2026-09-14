"use server";

import { getRequestId, scopedLogger } from "@/lib/logger";

const errorLogger = scopedLogger("error");

/**
 * Lets client error boundaries (`error.tsx`, `global-error.tsx`) get their
 * crash into server-side structured logs — `console.error` there only
 * reaches the browser console, which nothing on the server ever sees.
 */
export async function reportClientError(message: string, digest?: string, pathname?: string) {
  const requestId = await getRequestId();
  errorLogger.error({ digest, pathname, source: "client", ...(requestId ? { requestId } : {}) }, message);
}
