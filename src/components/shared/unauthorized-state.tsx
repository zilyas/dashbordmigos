import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Presentational 401 state — for future use wherever a page needs to render
 *  "sign in required" inline instead of redirecting. */
export function UnauthorizedState({
  title = "Sign in required",
  description = "You need to be signed in to view this page.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Lock className="size-5 text-muted-foreground" />
      </span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      <Button asChild size="sm">
        <Link href="/login">Sign in</Link>
      </Button>
    </div>
  );
}
