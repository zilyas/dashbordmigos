import { useTranslations } from "next-intl";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { paymentMethodLabel } from "@/lib/labels";
import type { SaleReceipt } from "@/lib/queries/sales";

export function Receipt({ receipt }: { receipt: NonNullable<SaleReceipt> }) {
  const t = useTranslations("receipt");
  const tLabels = useTranslations("labels");
  return (
    <div id="receipt-print-area" className="mx-auto flex w-full max-w-sm flex-col gap-4 font-mono text-sm">
      <div className="text-center">
        <p className="text-base font-semibold">{receipt.storeName}</p>
        <p className="text-xs text-muted-foreground">{formatDateTime(receipt.createdAt)}</p>
      </div>

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{t("invoice")}</span>
        <span>{receipt.invoiceNumber}</span>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{t("servedBy")}</span>
        <span>{receipt.sellerName}</span>
      </div>
      {receipt.customerName && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{t("customer")}</span>
          <span>{receipt.customerName}</span>
        </div>
      )}

      <div className="border-t border-dashed" />

      <div className="flex flex-col gap-1.5">
        {receipt.items.map((item, i) => (
          <div key={i} className="flex justify-between gap-2">
            <span className="flex-1">
              {item.name}
              <span className="text-muted-foreground"> × {item.quantity}</span>
            </span>
            <span className="tabular-nums">
              {formatCurrency(item.sellingPrice * item.quantity, receipt.currency)}
            </span>
          </div>
        ))}
      </div>

      <div className="border-t border-dashed" />

      <div className="flex flex-col gap-1">
        <div className="flex justify-between">
          <span>{t("subtotal")}</span>
          <span className="tabular-nums">{formatCurrency(receipt.subtotal, receipt.currency)}</span>
        </div>
        {receipt.discount > 0 && (
          <div className="flex justify-between">
            <span>{t("discount")}</span>
            <span className="tabular-nums">-{formatCurrency(receipt.discount, receipt.currency)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>{t("tax")}</span>
          <span className="tabular-nums">{formatCurrency(receipt.tax, receipt.currency)}</span>
        </div>
        <div className="flex justify-between border-t pt-1 text-base font-semibold">
          <span>{t("total")}</span>
          <span className="tabular-nums">{formatCurrency(receipt.total, receipt.currency)}</span>
        </div>
      </div>

      <div className="border-t border-dashed" />

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{t("paymentMethod")}</span>
        <span>{paymentMethodLabel(tLabels, receipt.paymentMethod)}</span>
      </div>

      <p className="text-center text-xs text-muted-foreground">{t("thankYou")}</p>
    </div>
  );
}
