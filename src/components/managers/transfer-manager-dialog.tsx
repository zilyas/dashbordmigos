"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { transferManager } from "@/actions/managers";
import type { ManagerListItem } from "@/lib/queries/users";

type StoreOption = { id: string; name: string; code: string };

export function TransferManagerDialog({
  open,
  onOpenChange,
  manager,
  stores,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manager: ManagerListItem;
  stores: StoreOption[];
}) {
  const t = useTranslations("people.managers.transferDialog");
  const tCommon = useTranslations("common");
  const [storeId, setStoreId] = useState("");
  const [isPending, startTransition] = useTransition();

  const otherStores = stores.filter((s) => s.id !== manager.storeId);

  function handleTransfer() {
    if (!storeId) {
      toast.error(t("errorSelectStore"));
      return;
    }
    startTransition(async () => {
      const result = await transferManager(manager.id, storeId);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(t("toastTransferred", { name: manager.name }));
      onOpenChange(false);
      setStoreId("");
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { name: manager.name, storeName: manager.storeName ?? t("currentStoreFallback") })}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel>{t("destinationLabel")}</FieldLabel>
          <Select value={storeId} onValueChange={setStoreId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("storePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {otherStores.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <DialogFooter className="mt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={handleTransfer} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {t("transfer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
