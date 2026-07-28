"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
  const [storeId, setStoreId] = useState("");
  const [isPending, startTransition] = useTransition();

  const otherStores = stores.filter((s) => s.id !== manager.storeId);

  function handleTransfer() {
    if (!storeId) {
      toast.error("Select a destination store");
      return;
    }
    startTransition(async () => {
      const result = await transferManager(manager.id, storeId);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${manager.name} transferred`);
      onOpenChange(false);
      setStoreId("");
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer manager</DialogTitle>
          <DialogDescription>
            Move {manager.name} from {manager.storeName ?? "their current store"} to a different store.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel>Destination store</FieldLabel>
          <Select value={storeId} onValueChange={setStoreId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a store" />
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
            Cancel
          </Button>
          <Button onClick={handleTransfer} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
