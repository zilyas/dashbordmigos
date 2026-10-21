"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import { ThemeProvider } from "next-themes";
import { SessionProvider } from "next-auth/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { shouldNavigateToOfflineShell } from "@/lib/offline-route";

/**
 * `refetchOnWindowFocus={false}` is load-bearing for the offline till.
 *
 * SessionProvider wraps every page, including /offline/pos, which the service
 * worker serves from its precache on a device with no network. Each refetch
 * hits /api/auth/session, which cannot resolve there, and Auth.js surfaces it
 * as an unhandled "Failed to fetch" that tore down the subtree before the
 * till had read its catalogue out of IndexedDB — the cashier saw "no
 * catalogue stored yet" on a device that had one.
 *
 * Session state is already refreshed on navigation and by the proxy's
 * per-request revocation check, so focus polling bought nothing and cost the
 * whole offline feature.
 */
/**
 * Moves the user to the precached /offline shell the moment connectivity
 * drops, before any server request is attempted.
 *
 * Dashboard pages are Server Components, so a navigation (or a cold reload)
 * with no network has no server to produce HTML: the document comes back 500
 * and the user gets "Something went wrong" instead of the offline screen. We
 * cannot wait for a failed API call to tell us — by then the error page has
 * already rendered.
 *
 * Two signals, for the same reason as the till in pos-terminal.tsx:
 * `useOffline()` only flips on the browser `offline` event or a rejected
 * framework fetch, so it reads `false` on a page the service worker served
 * from precache (no request was made, and the `offline` event fired before
 * this document existed). `navigator.onLine` catches exactly that cold start;
 * it is a hint only — true behind a captive portal — which is why nothing
 * here treats `online` as proof the server is reachable. Sync and lease
 * renewal keep verifying with GET /api/health and the snapshot route.
 *
 * Returning online deliberately navigates nowhere: a user reading pending
 * sales on /offline would lose the list under them. They choose when to leave.
 */
function OfflineRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  const frameworkOffline = useOffline();
  const [navigatorOffline, setNavigatorOffline] = useState(false);

  useEffect(() => {
    const read = () => setNavigatorOffline(!navigator.onLine);
    // Deferred to the next frame because this file's eslint config forbids a
    // synchronous setState in an effect body.
    const frame = requestAnimationFrame(read);
    window.addEventListener("online", read);
    window.addEventListener("offline", read);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("online", read);
      window.removeEventListener("offline", read);
    };
  }, []);

  const isOffline = frameworkOffline || navigatorOffline;

  useEffect(() => {
    if (!shouldNavigateToOfflineShell(pathname, isOffline)) return;
    // `replace`, not `push`: the page we are leaving cannot render without a
    // server, so leaving it on the back stack only sets up another 500.
    router.replace("/offline");
  }, [isOffline, pathname, router]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchOnWindowFocus={false} refetchWhenOffline={false}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <TooltipProvider delayDuration={200}>
          <OfflineRedirect />
          {children}
          <Toaster position="top-right" richColors closeButton />
        </TooltipProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
