import type { Metadata } from "next";
import { OfflineHomeClient } from "./offline-home-client";

export const metadata: Metadata = { title: "Offline" };

/**
 * The service worker's navigation fallback (public/sw.js), and the offline home
 * screen: what the shop sees when it opens the app with no network.
 *
 * Three constraints shape this file:
 *
 * 1. It is precached at install time, so it must be fully static — no session,
 *    no store data, no Prisma, no fetch. Anything dynamic would either fail to
 *    precache or bake in the session of whoever installed the app. Verify with
 *    `next build`: this route must print `○`. A `ƒ` means something server-side
 *    crept in and the worker precaches a page that cannot render without a
 *    server. Everything shop-specific is read from IndexedDB in the client half.
 *
 * 2. NO SESSION CONTENT in this HTML. It sits in a cache on a shared shop
 *    terminal. The branding below is deliberately generic; the store name, the
 *    cashier and every figure come from IndexedDB at runtime.
 *
 * 3. It must style itself. Tailwind classes resolve through a hashed stylesheet
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
          align-items: stretch;
          gap: 1rem;
          padding: 1.5rem 1rem 2.5rem;
          max-width: 40rem;
          margin: 0 auto;
          background: #ffffff;
          color: #0a0a0a;
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        }
        .offline-root h1 { font-size: 1.25rem; font-weight: 600; margin: 0; }
        .offline-root h2 { font-size: 0.9375rem; font-weight: 600; margin: 0; }
        .offline-root p { font-size: 0.875rem; line-height: 1.5; margin: 0; }
        .offline-muted { color: #737373; }
        .offline-head { display: flex; flex-direction: column; gap: 0.5rem; }
        .offline-head-row { display: flex; align-items: center; gap: 0.625rem; }
        .offline-head svg { width: 1.75rem; height: 1.75rem; color: #737373; flex: none; }
        .offline-status {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.75rem;
          font-weight: 600;
          padding: 0.1875rem 0.5rem;
          border-radius: 999px;
          background: #fef3c7;
          color: #92400e;
          margin-left: auto;
        }
        .offline-card {
          display: flex;
          flex-direction: column;
          gap: 0.625rem;
          border: 1px solid #e5e5e5;
          border-radius: 0.75rem;
          padding: 1rem;
        }
        .offline-card-head { display: flex; align-items: center; gap: 0.75rem; }
        .offline-card-head h2 { margin-right: auto; }
        .offline-card button {
          font: inherit;
          font-size: 0.8125rem;
          font-weight: 600;
          padding: 0.4375rem 0.875rem;
          border-radius: 0.5rem;
          border: 1px solid #d4d4d4;
          background: #ffffff;
          color: #0a0a0a;
          cursor: pointer;
        }
        .offline-card button:disabled { opacity: 0.6; cursor: default; }
        .offline-feedback { font-size: 0.8125rem; }
        .offline-feedback.tone-ok { color: #15803d; }
        .offline-feedback.tone-warn { color: #a16207; }
        .offline-feedback.tone-error { color: #b91c1c; }
        .offline-cta {
          display: block;
          text-align: center;
          font-size: 1rem;
          font-weight: 600;
          text-decoration: none;
          padding: 0.9375rem 1rem;
          border-radius: 0.75rem;
          background: #0a0a0a;
          color: #fafafa;
        }
        .offline-sales { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
        .offline-sales li {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          padding: 0.625rem 0;
          border-top: 1px solid #e5e5e5;
        }
        .offline-sales li:first-child { border-top: none; padding-top: 0; }
        .offline-sale-main { display: flex; align-items: baseline; gap: 0.75rem; font-size: 0.875rem; }
        .offline-sale-id { font-weight: 600; }
        .offline-sale-total { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 600; }
        .offline-sale-meta {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.75rem;
          color: #737373;
        }
        .offline-badge {
          margin-left: auto;
          font-weight: 600;
          padding: 0.125rem 0.4375rem;
          border-radius: 999px;
        }
        .offline-badge.tone-pending { background: #fef3c7; color: #92400e; }
        .offline-badge.tone-synced { background: #dcfce7; color: #166534; }
        .offline-badge.tone-review { background: #fee2e2; color: #991b1b; }
        @media (prefers-color-scheme: dark) {
          .offline-root { background: #0a0a0a; color: #fafafa; }
          .offline-muted, .offline-head svg, .offline-sale-meta { color: #a1a1a1; }
          .offline-card { border-color: #262626; }
          .offline-card button { background: #0a0a0a; color: #fafafa; border-color: #404040; }
          .offline-cta { background: #fafafa; color: #0a0a0a; }
          .offline-sales li { border-top-color: #262626; }
          .offline-status, .offline-badge.tone-pending { background: #422006; color: #fde68a; }
          .offline-badge.tone-synced { background: #052e16; color: #bbf7d0; }
          .offline-badge.tone-review { background: #450a0a; color: #fecaca; }
          .offline-feedback.tone-ok { color: #4ade80; }
          .offline-feedback.tone-warn { color: #fbbf24; }
          .offline-feedback.tone-error { color: #f87171; }
        }
      `}</style>
      <main className="offline-root">
        <header className="offline-head">
          <div className="offline-head-row">
            {/* Inline rather than lucide-react: this page must not depend on a
                JS bundle that may not be cached either. */}
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
            <h1>Store OS</h1>
            <span className="offline-status">Offline</span>
          </div>
          <p className="offline-muted">
            Running on data cached on this device. Selling still works; anything you ring up is
            queued here and uploaded on the next sync.
          </p>
        </header>
        <OfflineHomeClient />
      </main>
    </>
  );
}
