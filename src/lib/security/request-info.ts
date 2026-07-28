import { headers } from "next/headers";
import { UAParser } from "ua-parser-js";

export type RequestInfo = {
  ipAddress: string | null;
  userAgent: string | null;
  browser: string | null;
  os: string | null;
};

/**
 * Extracts client IP/UA/browser/OS from a Headers object. Works both with
 * the raw Request Auth.js's Credentials `authorize()` receives and with
 * next/headers() inside Server Actions / Route Handlers.
 */
export function extractRequestInfo(source: Headers): RequestInfo {
  const forwardedFor = source.get("x-forwarded-for");
  const ipAddress = forwardedFor?.split(",")[0]?.trim() || source.get("x-real-ip") || null;
  const userAgent = source.get("user-agent");

  let browser: string | null = null;
  let os: string | null = null;
  if (userAgent) {
    const parsed = UAParser(userAgent);
    browser = parsed.browser.name
      ? [parsed.browser.name, parsed.browser.version].filter(Boolean).join(" ")
      : null;
    os = parsed.os.name ? [parsed.os.name, parsed.os.version].filter(Boolean).join(" ") : null;
  }

  return { ipAddress, userAgent, browser, os };
}

export async function getRequestInfo(): Promise<RequestInfo> {
  return extractRequestInfo(await headers());
}
