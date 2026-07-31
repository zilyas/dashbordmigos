"use client";

import { useEffect } from "react";
import "./globals.css";
import { reportClientError } from "@/actions/errors";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
    reportClientError(error.message, error.digest, window.location.pathname).catch(() => {});
  }, [error]);

  return (
    <html lang="en" className="antialiased">
      <body className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 text-center">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <span className="text-sm font-semibold">S</span>
          </div>
          <span className="text-lg font-semibold tracking-tight">Store OS</span>
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
          <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
            A critical error occurred and the application couldn&apos;t load. Try again, and if it
            keeps happening, contact your administrator.
          </p>
        </div>
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
