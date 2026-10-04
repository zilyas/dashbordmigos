"use client";

import { WifiOff } from "lucide-react";
import { useOffline } from "next/offline";

/**
 * Connectivity banner, rendered in the root layout so it shows on every route.
 *
 * `useOffline` is more trustworthy than `navigator.onLine` here: a shop phone
 * on WiFi with a dead upstream still reports onLine === true, and this hook
 * also flips when a real navigation or Server Action fetch fails.
 * Requires `experimental.useOffline` in next.config.ts — without it the hook
 * is hardwired to false and this renders nothing.
 */
export function OfflineBanner() {
  const isOffline = useOffline();

  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-warning px-3 py-1.5 text-center text-xs font-medium text-warning-foreground"
      style={{ paddingTop: "max(0.375rem, env(safe-area-inset-top))" }}
    >
      <WifiOff className="size-3.5 shrink-0" aria-hidden />
      <span>Offline — changes you submit will be sent when the connection returns.</span>
    </div>
  );
}
