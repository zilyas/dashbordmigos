"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js once the page is interactive.
 *
 * Dev is excluded on purpose: a worker installed against a dev build keeps
 * controlling localhost afterwards and serves stale assets from a previous
 * session, which looks exactly like a caching bug in the app itself.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // Registration competes with hydration and first data fetches for the
    // network; defer it to after load so it never delays first paint.
    const register = () => {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // A failed registration must stay silent: the app works without it.
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
