"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refreshExpiryStatusAndNotifications } from "@/actions/batches";

/** Manager-only "recalculate expiry statuses + send due alerts" trigger. */
export function ExpiryRefreshButton() {
  const t = useTranslations("batches.refreshButton");
  const [isPending, start] = useTransition();

  function refresh() {
    start(async () => {
      const res = await refreshExpiryStatusAndNotifications();
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      const s = res.summary;
      toast.success(t("toastSummary", { statuses: s.statusesUpdated, notifications: s.notificationsCreated }));
    });
  }

  return (
    <Button variant="outline" className="gap-1.5" onClick={refresh} disabled={isPending}>
      {isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      {t("label")}
    </Button>
  );
}
