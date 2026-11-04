"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, MoreHorizontal, Pencil, Trash2, Undo2, Minus, Plus, ReceiptText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ReceiptDialog } from "@/components/sales/receipt-dialog";
import { deleteSale, returnSaleItems, updateSaleDetails, getReturnBatchOptions, type ReturnBatchOption } from "@/actions/sales";
import { round3 } from "@/lib/sale-math";
import { formatCurrency } from "@/lib/format";
import { PAYMENT_METHODS, paymentMethodLabel } from "@/lib/labels";
import type { SaleListItem } from "@/lib/queries/sales";
import type { PaymentMethod } from "@/generated/prisma/enums";

export function SaleActions({ sale, currency }: { sale: SaleListItem; currency: string }) {
  const t = useTranslations("sales.list");
  const tColumns = useTranslations("sales.list.columns");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const hasReturnableUnits = sale.items.some((i) => i.quantity - i.returnedQuantity > 0);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={tColumns("actionsLabel", { invoiceNumber: sale.invoiceNumber })}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setReceiptOpen(true)}>
            <ReceiptText />
            {tColumns("viewReceipt")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!hasReturnableUnits} onClick={() => setReturnOpen(true)}>
            <Undo2 />
            {tColumns("returnItems")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil />
            {tColumns("editDetails")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 />
            {tColumns("deleteSale")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {receiptOpen && (
        <ReceiptDialog
          sale={sale}
          currency={currency}
          open={receiptOpen}
          onOpenChange={setReceiptOpen}
        />
      )}

      {returnOpen && (
        <ReturnDialog
          sale={sale}
          currency={currency}
          open={returnOpen}
          onOpenChange={setReturnOpen}
        />
      )}

      {editOpen && <EditDialog sale={sale} open={editOpen} onOpenChange={setEditOpen} />}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteDialog.title", { invoiceNumber: sale.invoiceNumber })}
        description={t("deleteDialog.description")}
        confirmLabel={t("deleteDialog.confirm")}
        destructive
        onConfirm={async () => {
          const result = await deleteSale(sale.id);
          if (result?.error) {
            toast.error(result.error);
          } else {
            toast.success(t("deleteDialog.toastDeleted", { invoiceNumber: sale.invoiceNumber }));
          }
        }}
      />
    </>
  );
}

function ReturnDialog({
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
  const t = useTranslations("sales.list.returnDialog");
  const returnable = useMemo(
    () =>
      sale.items
        .map((i) => ({ ...i, remaining: i.quantity - i.returnedQuantity }))
        .filter((i) => i.remaining > 0),
    [sale.items]
  );

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  // Manager-only return-batch override options, fetched when the dialog opens.
  const [batchOptions, setBatchOptions] = useState<Record<string, ReturnBatchOption[]>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    let active = true;
    getReturnBatchOptions(sale.id).then((opts) => {
      if (active) setBatchOptions(opts);
    });
    return () => {
      active = false;
    };
  }, [open, sale.id]);

  function setQty(itemId: string, next: number, max: number) {
    setQuantities((prev) => ({ ...prev, [itemId]: round3(Math.max(0, Math.min(next, max))) }));
  }

  const selected = returnable
    .map((i) => ({ item: i, quantity: quantities[i.id] ?? 0 }))
    .filter((l) => l.quantity > 0);

  // Mirrors the server's proportional maths so the figure shown matches the
  // refund actually issued.
  const estimatedRefund = useMemo(() => {
    if (selected.length === 0) return 0;
    const gross = selected.reduce((sum, l) => sum + l.item.sellingPrice * l.quantity, 0);
    const share = sale.subtotal > 0 ? gross / sale.subtotal : 0;
    const discount = Math.round(sale.discount * share * 100) / 100;
    const tax = Math.round(sale.tax * share * 100) / 100;
    return Math.round((gross - discount + tax) * 100) / 100;
  }, [selected, sale.subtotal, sale.discount, sale.tax]);

  function handleSubmit() {
    if (selected.length === 0) {
      toast.error(t("errorChooseItem"));
      return;
    }
    startTransition(async () => {
      const result = await returnSaleItems(sale.id, {
        items: selected.map((l) => ({
          saleItemId: l.item.id,
          quantity: l.quantity,
          overrideBatchId: overrides[l.item.id] || "",
        })),
        reason,
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.fullyReturned
          ? t("toastFullyReturned", { invoiceNumber: sale.invoiceNumber, amount: formatCurrency(result.refundAmount ?? 0, currency) })
          : t("toastRefunded", { amount: formatCurrency(result.refundAmount ?? 0, currency) })
      );
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title", { invoiceNumber: sale.invoiceNumber })}</DialogTitle>
          <DialogDescription>
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {returnable.map((item) => {
            const qty = quantities[item.id] ?? 0;
            // Fractional control when the product is decimal-enabled or the sold
            // line is already fractional — enables partial fractional returns.
            const isDecimal =
              item.allowDecimalQuantity ||
              !Number.isInteger(item.quantity) ||
              !Number.isInteger(item.remaining);
            return (
              <div key={item.id} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {item.productName}
                    {item.variantLabel && (
                      <span className="ml-1 text-xs text-muted-foreground">· {item.variantLabel}</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatCurrency(item.sellingPrice, currency)} · {t("returnableOf", { remaining: item.remaining, quantity: item.quantity })}
                  </p>
                </div>
                {isDecimal ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Input
                      type="number"
                      step="0.001"
                      min={0}
                      max={item.remaining}
                      value={qty}
                      onChange={(e) => setQty(item.id, Number(e.target.value) || 0, item.remaining)}
                      className="h-8 w-20 text-right tabular-nums"
                      aria-label={t("returnQuantityAriaLabel", { name: item.productName })}
                    />
                    <span className="w-6 text-xs text-muted-foreground">{item.unit}</span>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={t("oneFewerAriaLabel", { name: item.productName })}
                      disabled={qty <= 0}
                      onClick={() => setQty(item.id, qty - 1, item.remaining)}
                    >
                      <Minus className="size-3" />
                    </Button>
                    <span className="w-6 text-center text-sm tabular-nums">{qty}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={t("oneMoreAriaLabel", { name: item.productName })}
                      disabled={qty >= item.remaining}
                      onClick={() => setQty(item.id, qty + 1, item.remaining)}
                    >
                      <Plus className="size-3" />
                    </Button>
                  </div>
                )}
                </div>
                {/* Manager-only: restore into a different batch than the original. */}
                {qty > 0 && batchOptions[item.id] && batchOptions[item.id].length > 0 && (
                  <div className="mt-2">
                    <Select
                      value={overrides[item.id] ?? ""}
                      onValueChange={(v) => setOverrides((prev) => ({ ...prev, [item.id]: v === "__original__" ? "" : v }))}
                    >
                      <SelectTrigger className="h-8 w-full text-xs">
                        <SelectValue placeholder={t("restoreToOriginalPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__original__">{t("restoreToOriginalDefault")}</SelectItem>
                        {batchOptions[item.id].map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.batchCode}
                            {b.expiryDate ? t("expLabel", { date: b.expiryDate }) : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            );
          })}

          <Field>
            <FieldLabel htmlFor="return-reason">{t("reasonLabel")}</FieldLabel>
            <Textarea
              id="return-reason"
              rows={2}
              placeholder={t("reasonPlaceholder")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>

          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">{t("refundAmount")}</span>
            <span className="font-semibold tabular-nums">
              {formatCurrency(estimatedRefund, currency)}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" disabled={isPending || selected.length === 0} onClick={handleSubmit}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {t("refundButton", { amount: formatCurrency(estimatedRefund, currency) })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  sale,
  open,
  onOpenChange,
}: {
  sale: SaleListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const tLabels = useTranslations("labels");
  const t = useTranslations("sales.list.editDialog");
  const [customerName, setCustomerName] = useState(sale.customerName ?? "");
  const [customerPhone, setCustomerPhone] = useState(sale.customerPhone ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(sale.paymentMethod);
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    startTransition(async () => {
      const result = await updateSaleDetails(sale.id, {
        customerName,
        customerPhone,
        paymentMethod,
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(t("toastUpdated"));
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title", { invoiceNumber: sale.invoiceNumber })}</DialogTitle>
          <DialogDescription>
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="edit-customer-name">{t("customerNameLabel")}</FieldLabel>
            <Input
              id="edit-customer-name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder={t("customerNamePlaceholder")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-customer-phone">{t("customerPhoneLabel")}</FieldLabel>
            <Input
              id="edit-customer-phone"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>{t("paymentMethodLabel")}</FieldLabel>
            <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {paymentMethodLabel(tLabels, value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" disabled={isPending} onClick={handleSubmit}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {t("saveChanges")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
