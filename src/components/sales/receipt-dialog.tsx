"use client";

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Receipt {sale.invoiceNumber}</DialogTitle>
          <DialogDescription>
            Print it, save it as an image, or send it to the customer.
          </DialogDescription>
        </DialogHeader>
        <Receipt receipt={receipt} />
        <ReceiptActions receipt={receipt} />
      </DialogContent>
    </Dialog>
  );
}
