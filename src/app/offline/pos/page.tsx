import type { Metadata } from "next";
import { OfflinePOSClient } from "./offline-pos-client";

export const metadata: Metadata = { title: "Offline till" };

/**
 * The till the service worker serves in place of /sales/new when the network
 * is gone (public/sw.js precaches this exact path).
 *
 * Three rules hold this file down, and breaking any one of them silently
 * breaks selling offline:
 *
 * 1. STATIC. No `auth()`, no `getSessionContext()`, no Prisma, no fetch — the
 *    route segment config in this Next version no longer has a `dynamic`
 *    export to force it, so staying static is purely a matter of importing
 *    nothing that reads a request. Verify with `next build`: this route must
 *    print `○` (prerendered). A `ƒ` means something server-side crept in and
 *    the worker will precache a page that cannot render without a server.
 *
 * 2. NO SESSION CONTENT. This HTML sits in a cache on a shared shop terminal,
 *    which is why sw.js refuses to cache any other page (see its header). The
 *    only reason /offline/pos is allowed in is that there is nothing of any
 *    user in it. Never render a name, a store, a role or a figure here —
 *    everything the till shows comes from IndexedDB, read in the client.
 *
 * 3. SELF-STYLED, like /offline. Tailwind lives in a hashed stylesheet under
 *    /_next/static; sw.js precaches this page's assets, but a till installed
 *    before this deploy can be controlled by an older worker whose precache
 *    never saw them. Inline CSS, colours hardcoded from globals.css, so the
 *    worst case is a plain page instead of unstyled serif at the till.
 */
export default function OfflinePOSPage() {
  return (
    <>
      <style>{`
        .pos-offline-root {
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          padding: 1.5rem;
          text-align: center;
          background: #ffffff;
          color: #0a0a0a;
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        }
        .pos-offline-root h1 { font-size: 1.25rem; font-weight: 600; margin: 0; }
        .pos-offline-root .pos-offline-note {
          max-width: 26rem;
          font-size: 0.875rem;
          line-height: 1.5;
          margin: 0;
          color: #737373;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .pos-offline-root .pos-offline-note p { margin: 0; }
        .pos-offline-root svg { width: 1rem; height: 1rem; color: #737373; }
        @media (prefers-color-scheme: dark) {
          .pos-offline-root { background: #0a0a0a; color: #fafafa; }
          .pos-offline-root .pos-offline-note, .pos-offline-root svg { color: #a1a1a1; }
        }
      `}</style>
      <main className="pos-offline-root">
        {/* Inline rather than lucide-react: the icon must not depend on a JS
            chunk that may not be in the worker's precache either. */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M16 11V7a4 4 0 0 0-8 0v4" />
          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
        </svg>
        <h1>Offline till</h1>
        <OfflinePOSClient />
      </main>
    </>
  );
}
