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
  Printer,
  ImageOff,
  ScanLine,
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Receipt } from "@/components/sales/receipt";
import { createSale } from "@/actions/sales";
import { formatCurrency } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import type { POSProduct } from "@/lib/queries/sales";
import type { PaymentMethod } from "@/generated/prisma/enums";
import type { SaleReceipt } from "@/lib/queries/sales";

type CartItem = POSProduct & { quantity: number };

export function POSTerminal({
  products,
  taxRate,
  currency,
  storeName,
  sellerName,
}: {
  products: POSProduct[];
  taxRate: number;
  currency: string;
  storeName: string;
  sellerName: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [isPending, startTransition] = useTransition();
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode?.toLowerCase().includes(q) ||
        p.color?.toLowerCase().includes(q)
    );
  }, [search, products]);

  function addToCart(product: POSProduct) {
    if (product.stock <= 0) {
      toast.error(`${product.name} is out of stock`);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((i) => i.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) {
          toast.error("No more stock available");
          return prev;
        }
        return prev.map((i) => (i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  }

  function updateQty(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.id !== productId) return i;
          const nextQty = i.quantity + delta;
          if (nextQty > i.stock) {
            toast.error("No more stock available");
            return i;
          }
          return { ...i, quantity: nextQty };
        })
        .filter((i) => i.quantity > 0)
    );
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((i) => i.id !== productId));
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const value = search.trim();
    if (!value) return;
    const barcodeMatch = products.find((p) => p.barcode === value || p.sku === value);
    if (barcodeMatch) {
      addToCart(barcodeMatch);
      setSearch("");
    }
  }

  const subtotal = cart.reduce((sum, i) => sum + i.sellingPrice * i.quantity, 0);
  const discountAmount = subtotal * (discountPercent / 100);
  const taxableAmount = subtotal - discountAmount;
  const tax = taxableAmount * (taxRate / 100);
  const total = taxableAmount + tax;

  function handleCompleteSale() {
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
        items: cart.map((i) => ({ productId: i.id, quantity: i.quantity })),
      });

      if (!result || "error" in result) {
        toast.error(result?.error ?? "Failed to complete sale");
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
          name: i.name,
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
                onClick={() => addToCart(product)}
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
                </div>
                <div className="flex flex-col gap-0.5 p-2.5">
                  <p className="truncate text-sm font-medium">{product.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[product.size, product.color].filter(Boolean).join(" · ") || product.sku}
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
                <div key={item.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatCurrency(item.sellingPrice, currency)} each
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      className="size-6"
                      onClick={() => updateQty(item.id, -1)}
                    >
                      <Minus className="size-3" />
                    </Button>
                    <span className="w-5 text-center text-sm tabular-nums">{item.quantity}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      className="size-6"
                      onClick={() => updateQty(item.id, 1)}
                    >
                      <Plus className="size-3" />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => removeFromCart(item.id)}
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

          <Button size="lg" disabled={isPending || cart.length === 0} onClick={handleCompleteSale}>
            {isPending ? "Processing..." : `Complete Sale · ${formatCurrency(total, currency)}`}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={!!receipt} onOpenChange={(open) => !open && setReceipt(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Sale complete</DialogTitle>
          </DialogHeader>
          {receipt && <Receipt receipt={receipt} />}
          <Button className="mt-2 gap-1.5 print:hidden" onClick={() => window.print()}>
            <Printer className="size-4" />
            Print receipt
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
