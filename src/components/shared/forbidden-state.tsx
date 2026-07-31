import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Presentational 403 state — for future use wherever a page needs to render
 *  "access denied" inline instead of redirecting. */
export function ForbiddenState({
  title = "Access denied",
  description = "You don't have permission to view this page.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
        <ShieldAlert className="size-5 text-destructive" />
      </span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
