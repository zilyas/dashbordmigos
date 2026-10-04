"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Install-to-home-screen prompt.
 *
 * Two different platforms, two different mechanisms:
 *  - Chromium fires `beforeinstallprompt`, which we stash and replay on click.
 *    The event must be preventDefault()ed or Chrome shows its own mini-infobar
 *    as well, and `prompt()` may only be called from a user gesture.
 *  - iOS Safari has no such event at all. Installing is a manual Share > Add to
 *    Home Screen, so all we can do is say so.
 *
 * Dismissal is remembered in localStorage — this is a UI preference, not a
 * credential, and losing it on a cache clear only re-offers the install.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "pwa-install-dismissed";

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(true); // assume dismissed until localStorage is read

  useEffect(() => {
    if (localStorage.getItem(DISMISSED_KEY) === "1") return;

    // Already installed: standalone display mode, or iOS's non-standard flag.
    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true);
    if (installed) return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iOS has no install event to subscribe to, so eligibility there is a plain
    // UA check. Deferring it to an animation frame keeps this effect free of a
    // synchronous setState (which would cascade a second render during
    // hydration) and means the prompt lands after first paint, not during it.
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isSafari = /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);
    const frame = requestAnimationFrame(() => {
      setDismissed(false);
      if (isIos && isSafari) setShowIosHint(true);
    });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("beforeinstallprompt", onPrompt);
    };
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    // The event is single-use; a second prompt() on it throws.
    setDeferred(null);
    dismiss();
  }

  if (dismissed || (!deferred && !showIosHint)) return null;

  return (
    <div
      className="fixed inset-x-3 bottom-3 z-50 flex items-center gap-3 rounded-xl border bg-card p-3 shadow-lg md:left-auto md:w-96"
      style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Install this dashboard</p>
        <p className="text-xs text-muted-foreground">
          {deferred ? (
            "Add it to your home screen for full-screen, app-like access."
          ) : (
            <>
              Tap <Share className="inline size-3 align-[-2px]" aria-label="Share" /> then
              &ldquo;Add to Home Screen&rdquo;.
            </>
          )}
        </p>
      </div>
      {deferred && (
        <Button size="sm" onClick={install}>
          <Download className="size-4" aria-hidden />
          Install
        </Button>
      )}
      <Button size="icon" variant="ghost" onClick={dismiss} aria-label="Dismiss install prompt">
        <X className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
