"use client";

import { useState } from "react";
import { ReceiptText } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { ReceiptDialog } from "@/components/sales/receipt-dialog";
import type { SaleListItem } from "@/lib/queries/sales";

/** Row-level receipt access for users without the manage dropdown (sellers). */
export function SaleReceiptButton({
  sale,
  currency,
}: {
  sale: SaleListItem;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("receipt");

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("viewReceiptAriaLabel", { invoiceNumber: sale.invoiceNumber })}
        onClick={() => setOpen(true)}
      >
        <ReceiptText className="size-4" />
      </Button>
      {open && (
        <ReceiptDialog sale={sale} currency={currency} open={open} onOpenChange={setOpen} />
      )}
    </>
  );
}
