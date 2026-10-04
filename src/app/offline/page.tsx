import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline" };

/**
 * The service worker's navigation fallback (public/sw.js).
 *
 * Two constraints shape this file:
 *
 * 1. It is precached at install time, so it must be fully static — no session,
 *    no store data, no Prisma. Anything dynamic would either fail to precache or
 *    bake in the session of whoever installed the app.
 *
 * 2. It must style itself. Tailwind classes resolve through a hashed stylesheet
 *    under /_next/static, and on a cold offline load that file may never have
 *    been fetched — the page would render as unstyled serif text at the exact
 *    moment the user is already confused about why nothing works. Everything
 *    here is therefore inline, with the colours hardcoded from globals.css
 *    (--background / --foreground / --muted-foreground, light and dark).
 */
export default function OfflinePage() {
  return (
    <>
      <style>{`
        .offline-root {
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1rem;
          padding: 1.5rem;
          text-align: center;
          background: #ffffff;
          color: #0a0a0a;
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        }
        .offline-root h1 { font-size: 1.25rem; font-weight: 600; margin: 0; }
        .offline-root p { max-width: 24rem; font-size: 0.875rem; line-height: 1.5; margin: 0; color: #737373; }
        .offline-root svg { width: 2.5rem; height: 2.5rem; color: #737373; }
        @media (prefers-color-scheme: dark) {
          .offline-root { background: #0a0a0a; color: #fafafa; }
          .offline-root p, .offline-root svg { color: #a1a1a1; }
        }
      `}</style>
      <main className="offline-root">
        {/* Inline rather than lucide-react: this page must not depend on a JS
            bundle that may not be cached either. */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 20h.01" />
          <path d="M8.5 16.429a5 5 0 0 1 7 0" />
          <path d="M5 12.859a10 10 0 0 1 5.17-2.69" />
          <path d="M19 12.859a10 10 0 0 0-2.007-1.523" />
          <path d="M2 8.82a15 15 0 0 1 4.177-2.643" />
          <path d="M22 8.82a15 15 0 0 0-11.288-3.764" />
          <path d="m2 2 20 20" />
        </svg>
        <h1>You are offline</h1>
        <p>
          This page needs a connection. Reconnect and it will load — anything you
          submitted is retried automatically once you are back online.
        </p>
      </main>
    </>
  );
}
