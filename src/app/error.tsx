"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/shared/brand-mark";
import { reportClientError } from "@/actions/errors";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const pathname = usePathname();

  useEffect(() => {
    console.error(error);
    reportClientError(error.message, error.digest, pathname).catch(() => {});
  }, [error, pathname]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 text-center">
      <BrandMark />
      <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="size-5 text-destructive" />
      </span>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
          An unexpected error occurred. Try again, and if it keeps happening, contact your
          administrator.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => unstable_retry()} className="gap-1.5">
          <RotateCw className="size-3.5" />
          Try again
        </Button>
        <Button asChild>
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
