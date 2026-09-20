"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  ImageOff,
  ScanLine,
  Layers,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Receipt } from "@/components/sales/receipt";
import { ReceiptActions } from "@/components/sales/receipt-actions";
import { createSale } from "@/actions/sales";
import { round3 } from "@/lib/sale-math";
import { matchesAny } from "@/lib/text";
import { formatCurrency } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import type { POSProduct, POSVariant } from "@/lib/queries/sales";
import type { PaymentMethod } from "@/generated/prisma/enums";
import type { SaleReceipt } from "@/lib/queries/sales";

// A cart line is keyed by product+variant so the same product can be in the
// cart as several distinct variants.
type CartLine = {
  lineKey: string;
  productId: string;
  name: string;
  sku: string;
  variantId: string | null;
  variantLabel: string | null;
  sellingPrice: number;
  stock: number;
  quantity: number;
  allowDecimal: boolean;
  unit: string;
};

function lineFromProduct(product: POSProduct, allowDecimal: boolean): CartLine {
  return {
    lineKey: product.id,
    productId: product.id,
    name: product.name,
    sku: product.sku,
    variantId: null,
    variantLabel: null,
    sellingPrice: product.sellingPrice,
    stock: product.stock,
    quantity: 1,
    allowDecimal,
    unit: product.unit,
  };
}

function lineFromVariant(product: POSProduct, variant: POSVariant, allowDecimal: boolean): CartLine {
  return {
    lineKey: `${product.id}:${variant.id}`,
    productId: product.id,
    name: product.name,
    sku: variant.sku,
    variantId: variant.id,
    variantLabel: variant.label,
    sellingPrice: variant.sellingPrice,
    stock: variant.stock,
    quantity: 1,
    allowDecimal,
    unit: product.unit,
  };
}

export function POSTerminal({
  products,
  taxRate,
  currency,
  storeName,
  sellerName,
  unitsEnabled = false,
  isManager = false,
}: {
  products: POSProduct[];
  taxRate: number;
  currency: string;
  storeName: string;
  sellerName: string;
  /** Store has units_enabled — decimal-enabled products can be sold fractionally. */
  unitsEnabled?: boolean;
  /** Manager session — may confirm an expired-stock override (Phase 5). */
  isManager?: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [isPending, startTransition] = useTransition();
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  const [pickerProduct, setPickerProduct] = useState<POSProduct | null>(null);
  // Manager expired-stock override confirmation (Phase 5).
  const [expiredPromptOpen, setExpiredPromptOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const filteredProducts = useMemo(() => {
    const q = search.trim();
    if (!q) return products;
    // Accent-insensitive across name/sku/barcode/color and each variant's
    // sku+label, so "creme" matches "Crème" and a variant SKU/label is findable.
    return products.filter((p) =>
      matchesAny(
        [p.name, p.sku, p.barcode, p.color, ...p.variants.flatMap((v) => [v.sku, v.label])],
        q
      )
    );
  }, [search, products]);

  function addLine(line: CartLine) {
    if (line.stock <= 0) {
      toast.error(`${line.name} is out of stock`);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((i) => i.lineKey === line.lineKey);
      if (existing) {
        if (existing.quantity >= line.stock) {
          toast.error("No more stock available");
          return prev;
        }
        return prev.map((i) => (i.lineKey === line.lineKey ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prev, line];
    });
  }

  const allowsDecimal = (p: POSProduct) => unitsEnabled && p.allowDecimalQuantity;

  // Clicking a product either adds it directly (simple product) or opens the
  // variant picker (variant-enabled product).
  function onProductClick(product: POSProduct) {
    if (product.hasVariants) {
      setPickerProduct(product);
      return;
    }
    addLine(lineFromProduct(product, allowsDecimal(product)));
  }

  function updateQty(lineKey: string, delta: number) {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.lineKey !== lineKey) return i;
          const nextQty = round3(i.quantity + delta);
          if (nextQty > i.stock) {
            toast.error("No more stock available");
            return i;
          }
          return { ...i, quantity: nextQty };
        })
        .filter((i) => i.quantity > 0)
    );
  }

  // Sets an exact (possibly decimal) quantity from the input for a decimal line.
  function setExactQty(lineKey: string, raw: number, stock: number) {
    const clamped = Math.min(Math.max(round3(raw), 0), stock);
    setCart((prev) => prev.map((i) => (i.lineKey === lineKey ? { ...i, quantity: clamped } : i)));
  }

  function removeFromCart(lineKey: string) {
    setCart((prev) => prev.filter((i) => i.lineKey !== lineKey));
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const value = search.trim();
    if (!value) return;
    // Barcode/SKU scan: match a simple product, or a specific variant SKU.
    for (const p of products) {
      if (!p.hasVariants && (p.barcode === value || p.sku === value)) {
        addLine(lineFromProduct(p, allowsDecimal(p)));
        setSearch("");
        return;
      }
      const variant = p.variants.find((v) => v.sku === value);
      if (variant) {
        addLine(lineFromVariant(p, variant, allowsDecimal(p)));
        setSearch("");
        return;
      }
    }
  }

  const subtotal = cart.reduce((sum, i) => sum + i.sellingPrice * i.quantity, 0);
  const discountAmount = subtotal * (discountPercent / 100);
  const taxableAmount = subtotal - discountAmount;
  const tax = taxableAmount * (taxRate / 100);
  const total = taxableAmount + tax;

  function handleCompleteSale(allowExpiredOverride = false) {
    if (cart.length === 0) {
      toast.error("Add at least one product to the cart");
      return;
    }

    startTransition(async () => {
      const result = await createSale({
        customerName,
        customerPhone,
        discountPercent,
        paymentMethod,
        items: cart.map((i) => ({ productId: i.productId, variantId: i.variantId ?? "", quantity: i.quantity })),
        ...(allowExpiredOverride ? { allowExpiredOverride: true } : {}),
      });

      if (!result || "error" in result) {
        const msg = result?.error ?? "Failed to complete sale";
        // Manager-only: offer to knowingly sell expired stock when that's the
        // only thing blocking the sale. Sellers never see this path.
        if (isManager && !allowExpiredOverride && /non-expired stock/i.test(msg)) {
          setExpiredPromptOpen(true);
          return;
        }
        toast.error(msg);
        return;
      }

      setReceipt({
        id: result.saleId,
        invoiceNumber: result.invoiceNumber,
        sellerName,
        customerName: customerName || null,
        customerPhone: customerPhone || null,
        subtotal,
        discount: discountAmount,
        tax,
        total,
        paymentMethod,
        createdAt: new Date().toISOString(),
        storeName,
        currency,
        items: cart.map((i) => ({
          name: i.variantLabel ? `${i.name} (${i.variantLabel})` : i.name,
          sku: i.sku,
          quantity: i.quantity,
          sellingPrice: i.sellingPrice,
        })),
      });

      setCart([]);
      setCustomerName("");
      setCustomerPhone("");
      setDiscountPercent(0);
      setPaymentMethod("CASH");
      toast.success("Sale completed");
      router.refresh();
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
      <div className="flex flex-col gap-4">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search by name, SKU, or scan a barcode..."
            className="h-11 pl-10"
          />
          <ScanLine className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>

        {filteredProducts.length === 0 ? (
          <EmptyState icon={<Search />} title="No products match your search" />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {filteredProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => onProductClick(product)}
                disabled={product.stock <= 0}
                className="flex flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
              >
                <div className="relative aspect-square w-full bg-muted">
                  {product.image ? (
                    <Image src={product.image} alt={product.name} fill className="object-cover" sizes="180px" />
                  ) : (
                    <div className="flex size-full items-center justify-center text-muted-foreground">
                      <ImageOff className="size-6" />
                    </div>
                  )}
                  {product.stock <= 0 && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                      <StatusBadge variant="destructive">Out of stock</StatusBadge>
                    </div>
                  )}
                  {product.hasVariants && product.stock > 0 && (
                    <div className="absolute top-1.5 right-1.5">
                      <StatusBadge>
                        <Layers className="mr-1 size-3" />
                        {product.variants.length}
                      </StatusBadge>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 p-2.5">
                  <p className="truncate text-sm font-medium">{product.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {product.hasVariants
                      ? "Choose a variant"
                      : [product.size, product.color].filter(Boolean).join(" · ") || product.sku}
                  </p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums">
                    {formatCurrency(product.sellingPrice, currency)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <Card className="h-fit lg:sticky lg:top-18">
        <CardHeader className="border-b pb-4">
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="size-4" />
            Cart ({cart.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-4">
          {cart.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Add products from the left to start a sale.
            </p>
          ) : (
            <div className="flex max-h-64 flex-col gap-3 overflow-y-auto pr-1">
              {cart.map((item) => (
                <div key={item.lineKey} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {item.name}
                      {item.variantLabel && (
                        <span className="ml-1 text-xs text-muted-foreground">· {item.variantLabel}</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatCurrency(item.sellingPrice, currency)} each
                    </p>
                  </div>
                  {item.allowDecimal ? (
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        step="0.001"
                        min={0}
                        value={item.quantity}
                        onChange={(e) => setExactQty(item.lineKey, Number(e.target.value) || 0, item.stock)}
                        className="h-7 w-20 text-right tabular-nums"
                        aria-label={`Quantity for ${item.name}`}
                      />
                      <span className="w-6 text-xs text-muted-foreground">{item.unit}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        className="size-6"
                        onClick={() => updateQty(item.lineKey, -1)}
                      >
                        <Minus className="size-3" />
                      </Button>
                      <span className="w-5 text-center text-sm tabular-nums">{item.quantity}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        className="size-6"
                        onClick={() => updateQty(item.lineKey, 1)}
                      >
                        <Plus className="size-3" />
                      </Button>
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => removeFromCart(item.lineKey)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2 border-t pt-3">
            <Input
              placeholder="Customer name (optional)"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
            <Input
              placeholder="Customer phone (optional)"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(Number(e.target.value) || 0)}
                  className="w-full"
                />
                <span className="text-sm text-muted-foreground">% off</span>
              </div>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 border-t pt-3 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatCurrency(subtotal, currency)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Discount</span>
              <span className="tabular-nums">-{formatCurrency(discountAmount, currency)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Tax ({taxRate}%)</span>
              <span className="tabular-nums">{formatCurrency(tax, currency)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(total, currency)}</span>
            </div>
          </div>

          <Button size="lg" disabled={isPending || cart.length === 0} onClick={() => handleCompleteSale()}>
            {isPending ? "Processing..." : `Complete Sale · ${formatCurrency(total, currency)}`}
          </Button>
        </CardContent>
      </Card>

      {/* Variant picker for variant-enabled products */}
      <Dialog open={!!pickerProduct} onOpenChange={(open) => !open && setPickerProduct(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{pickerProduct?.name}</DialogTitle>
            <DialogDescription>Choose a variant to add to the cart.</DialogDescription>
          </DialogHeader>
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {pickerProduct?.variants.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                This product has no active variants.
              </p>
            )}
            {pickerProduct?.variants.map((variant) => (
              <button
                key={variant.id}
                type="button"
                disabled={variant.stock <= 0}
                onClick={() => {
                  addLine(lineFromVariant(pickerProduct, variant, allowsDecimal(pickerProduct)));
                  setPickerProduct(null);
                }}
                className="flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary/50 disabled:pointer-events-none disabled:opacity-50"
              >
                {/* The variant's own photo — a shade or color is far easier to
                    pick from a picture than from a label. */}
                <div className="relative size-10 shrink-0 overflow-hidden rounded-md border bg-muted">
                  {variant.imageUrl ? (
                    <Image src={variant.imageUrl} alt={variant.label} fill className="object-cover" sizes="40px" />
                  ) : (
                    <Layers className="absolute inset-0 m-auto size-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{variant.label}</p>
                  <p className="text-xs text-muted-foreground">
                    SKU {variant.sku} · {variant.stock > 0 ? `${variant.stock} in stock` : "out of stock"}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums">
                  {formatCurrency(variant.sellingPrice, currency)}
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Manager-only: confirm knowingly selling otherwise-blocked expired stock (Phase 5). */}
      <ConfirmDialog
        open={expiredPromptOpen}
        onOpenChange={setExpiredPromptOpen}
        title="Sell expired stock anyway?"
        description="Non-expired stock isn't enough to cover this sale. As a manager, you can knowingly complete it using expired stock instead. This is recorded on the sale and in the activity log."
        confirmLabel="Sell expired stock"
        destructive
        onConfirm={() => handleCompleteSale(true)}
      />

      <Dialog open={!!receipt} onOpenChange={(open) => !open && setReceipt(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Sale complete</DialogTitle>
          </DialogHeader>
          {receipt && (
            <>
              <Receipt receipt={receipt} />
              <ReceiptActions receipt={receipt} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
