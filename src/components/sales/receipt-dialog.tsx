"use client";

import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Receipt } from "@/components/sales/receipt";
import { ReceiptActions } from "@/components/sales/receipt-actions";
import { saleToReceipt } from "@/lib/receipt-image";
import type { SaleListItem } from "@/lib/queries/sales";

/** Reprints a past sale. The list row already carries every line, so no fetch. */
export function ReceiptDialog({
  sale,
  currency,
  open,
  onOpenChange,
}: {
  sale: SaleListItem;
  currency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const receipt = saleToReceipt(sale, currency);
  const t = useTranslations("receipt");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("dialog.title", { invoiceNumber: sale.invoiceNumber })}</DialogTitle>
          <DialogDescription>{t("dialog.description")}</DialogDescription>
        </DialogHeader>
        <Receipt receipt={receipt} />
        <ReceiptActions receipt={receipt} />
      </DialogContent>
    </Dialog>
  );
}
