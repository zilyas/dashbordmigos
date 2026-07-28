"use client";

import { useTransition } from "react";
import { CheckCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markAllNotificationsRead } from "@/actions/notifications";

export function MarkAllReadButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await markAllNotificationsRead();
        })
      }
    >
      {isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}
      Mark all read
    </Button>
  );
}
