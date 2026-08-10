"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
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
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleReset() {
    startTransition(async () => {
      const result = await resetStoreData(storeId, confirmText);
      if (!result || "error" in result) {
        toast.error(result?.error ?? "Failed to reset the store");
        return;
      }
      toast.success(`${storeName} reset — ${result.sales} sale(s) cleared`);
      setOpen(false);
      setConfirmText("");
    });
  }

  return (
    <Card className="border-destructive/30">
      <CardHeader className="border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-destructive">
          <TriangleAlert className="size-4" />
          Danger zone
        </CardTitle>
        <CardDescription>
          Clears this store&apos;s trading history — sales, inventory movements and expenses.
          Products, categories, staff and settings are kept.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <Button variant="destructive" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
          Reset store data
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
            <AlertDialogTitle>Reset &quot;{storeName}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every sale, inventory movement and expense for this store.
              Products, categories, staff and settings survive. Stock levels stay where they are —
              adjust them afterwards if needed. This cannot be undone. Type{" "}
              <strong>{RESET_CONFIRMATION_TEXT}</strong> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={RESET_CONFIRMATION_TEXT}
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={isPending || confirmText !== RESET_CONFIRMATION_TEXT}
              onClick={handleReset}
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Reset store data
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
