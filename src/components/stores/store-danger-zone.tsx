"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Loader2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { resetStoreData } from "@/actions/stores";

// Mirrors the constant in actions/stores.ts — that module is "use server" and
// so can only export async functions, not shared constants.
const RESET_CONFIRMATION_TEXT = "RESET";

export function StoreDangerZone({ storeId, storeName }: { storeId: string; storeName: string }) {
  const t = useTranslations("storeDetail.dangerZone");
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleReset() {
    startTransition(async () => {
      const result = await resetStoreData(storeId, confirmText);
      if (!result || "error" in result) {
        toast.error(result?.error ?? t("resetButton"));
        return;
      }
      toast.success(t("toastReset", { storeName, count: result.sales }));
      setOpen(false);
      setConfirmText("");
    });
  }

  return (
    <Card className="border-destructive/30">
      <CardHeader className="border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-destructive">
          <TriangleAlert className="size-4" />
          {t("title")}
        </CardTitle>
        <CardDescription>
          {t("description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <Button variant="destructive" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
          {t("resetButton")}
        </Button>
      </CardContent>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setConfirmText("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("resetTitle", { storeName })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.rich("resetDescription", {
                confirmText: RESET_CONFIRMATION_TEXT,
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={RESET_CONFIRMATION_TEXT}
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{t("cancel")}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={isPending || confirmText !== RESET_CONFIRMATION_TEXT}
              onClick={handleReset}
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {t("resetButton")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
