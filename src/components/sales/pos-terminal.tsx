"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useOffline } from "next/offline";
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
  CloudOff,
  RefreshCw,
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Receipt } from "@/components/sales/receipt";
import { ReceiptActions } from "@/components/sales/receipt-actions";
import { createSale } from "@/actions/sales";
import type { CachedProduct, CachedVariant } from "@/lib/offline/db";
import { loadOfflineState, recordOfflineSale, refreshSnapshot, syncNow } from "@/lib/offline/sync";
import { evaluateCachedLease, pendingQuantities } from "@/lib/offline/recent-sales";
import type { LeaseState, StockKey } from "@/lib/offline/recent-sales";
import {
  describeRecordResult,
  offlineCatalogue,
  offlineSaleGate,
  type OfflineProductRow,
} from "@/components/sales/pos-offline";
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

// The cached catalogue carries `price` (and no image) where the online query
// carries `sellingPrice`, so offline lines are built from their own mappers
// rather than casting one shape into the other.
function lineFromCached(product: CachedProduct, stock: number, allowDecimal: boolean): CartLine {
  return {
    lineKey: product.id,
    productId: product.id,
    name: product.name,
    sku: product.sku,
    variantId: null,
    variantLabel: null,
    sellingPrice: product.price,
    stock,
    quantity: 1,
    allowDecimal,
    unit: product.unit,
  };
}

function lineFromCachedVariant(
  product: CachedProduct,
  variant: CachedVariant,
  stock: number,
  allowDecimal: boolean
): CartLine {
  return {
    lineKey: `${product.id}:${variant.id}`,
    productId: product.id,
    name: product.name,
    sku: variant.sku,
    variantId: variant.id,
    variantLabel: variant.label,
    sellingPrice: variant.price,
    stock,
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
  cacheOnly = false,
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
  /**
   * Render from the IndexedDB cache regardless of connectivity.
   *
   * Set only by /offline/pos, which the service worker serves from its
   * precache and which therefore has NO server-fetched `products` -- it is
   * mounted with `[]`. Without this flag, opening that page while the network
   * happened to be up rendered the online grid against that empty array and
   * showed "No products match your search" on a till holding a full cached
   * catalogue. The live POS at /sales/new leaves it false and is unaffected.
   */
  cacheOnly?: boolean;
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

  /* ---------- offline selling ---------- */

  // `experimental.useOffline` is on, so this also flips on a failed framework
  // fetch, not only on the browser's `offline` event.
  const frameworkOffline = useOffline();

  // ...but it cannot be the only signal here, and that cost us the feature.
  //
  // Per node_modules/next/dist/docs/.../useOffline.md the hook enters the
  // offline state ONLY via the `offline` event or a framework fetch that
  // rejects. The till reached from the service worker's precache does neither:
  // the page is served from cache with no network request at all, and the
  // `offline` event fired before this document existed. So the hook read
  // `false` on a device with no network, the online grid rendered against an
  // empty `products` prop, and the cashier saw "No products match your
  // search" with a full cached catalogue sitting in IndexedDB.
  //
  // `navigator.onLine` is unreliable on its own -- it reports true behind a
  // captive portal -- but it is never wrong about a hard disconnection, which
  // is the case the hook misses. OR-ing the two covers both: the hook catches
  // the portal, the flag catches the cold start.
  const [navigatorOffline, setNavigatorOffline] = useState(false);
  useEffect(() => {
    const read = () => setNavigatorOffline(!navigator.onLine);
    // Deferred for the same reason as the other effects here: this file's
    // eslint config forbids a synchronous setState in an effect body.
    const frame = requestAnimationFrame(read);
    window.addEventListener("online", read);
    window.addEventListener("offline", read);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("online", read);
      window.removeEventListener("offline", read);
    };
  }, []);

  const isOffline = frameworkOffline || navigatorOffline;

  // What the GRID reads from. `cacheOnly` forces the cached catalogue even
  // when connected, because on that page there is nothing else to show.
  // Selling is still gated on `isOffline`/the lease, not on this.
  // NOTE: cacheOnly takes precedence over isOffline; /offline/pos always has
  // no server data, so the cached grid must render regardless of connectivity.
  const useCachedCatalogue = cacheOnly ? true : isOffline;
  const [offlineData, setOfflineData] = useState<{
    products: CachedProduct[];
    held: Map<StockKey, number>;
    lease: LeaseState;
    pending: number;
  } | null>(null);
  const [offlineSaving, setOfflineSaving] = useState(false);
  const [offlinePicker, setOfflinePicker] = useState<CachedProduct | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  // Minted on the first press of Complete sale and held until that sale is on
  // disk. A retry after a failed write MUST reuse it: a fresh uuid is a second
  // idempotency key, and the server would then happily book the sale twice.
  const clientSaleIdRef = useRef<string | null>(null);

  const readOffline = useCallback(async () => {
    try {
      const state = await loadOfflineState();
      const unsynced = state.pendingSales.filter((s) => s.status !== "synced");
      setOfflineData({
        products: state.products,
        held: pendingQuantities(state.pendingSales),
        lease: await evaluateCachedLease(state.lease, state.publicKey),
        // Counts `review` too — those goods left the shop, so the figure must
        // never read as zero work outstanding.
        pending: unsynced.length,
      });
    } catch {
      // A blocked or broken IndexedDB must not break the online till, which is
      // the only thing on screen when this fails while connected.
      setOfflineData(null);
    }
  }, []);

  // Set when the server refuses to issue a lease (suspended account, offline
  // mode unconfigured). Distinct from "expired": retrying will not help until
  // somebody fixes the subscription, so the dialog must say so rather than
  // inviting the cashier to press Retry forever.
  const [leaseDenied, setLeaseDenied] = useState<string | null>(null);
  // Lets the cashier step past the blocking dialog to LOOK at the queue. It
  // does not unblock selling: the gate still refuses, so the sale button
  // stays disabled underneath.
  const [pendingPeek, setPendingPeek] = useState(false);
  const [renewing, setRenewing] = useState(false);

  /**
   * Reconnect and ask the server to re-authorise this device.
   *
   * The snapshot route is the authority: it re-checks eligibility and issues a
   * fresh lease only if the account is still active. A renewal therefore
   * cannot be faked locally, which is the whole point of the dialog having no
   * dismiss button.
   */
  const retryConnection = useCallback(async () => {
    setRenewing(true);
    try {
      const result = await refreshSnapshot();
      if (!result.ok) {
        toast.error("Still no connection. Check the network and try again.");
        return;
      }
      setLeaseDenied(result.leaseDenied);
      if (result.leaseDenied) {
        toast.error("This store's offline access is not active. Contact the owner.");
      } else {
        toast.success("Offline access renewed.");
      }
    } catch {
      toast.error("Could not reach the server. Check the network and try again.");
    } finally {
      setRenewing(false);
      // Re-reads the lease from IndexedDB, which is what closes the dialog:
      // the gate recomputes from the newly stored permit, not from a flag.
      await readOffline();
    }
  }, [readOffline]);

  const runSync = useCallback(
    async (manual: boolean) => {
      setSyncing(true);
      try {
        const summary = await syncNow();
        if (summary.ran && !summary.stopped) setLastSyncAt(new Date());
        if (manual) {
          if (summary.stopped) toast.error(summary.message ?? "Sync stopped.");
          else if (!summary.ran) toast.info("A sync is already running.");
          else if (summary.uploaded === 0) toast.info("Nothing to sync.");
          else toast.success(`${summary.uploaded} sale(s) sent.`);
        }
        if (summary.review > 0) toast.error(`${summary.review} sale(s) need review.`);
      } finally {
        setSyncing(false);
        await readOffline();
      }
    },
    [readOffline]
  );

  // One read per connectivity flip: going dark needs the catalogue, coming back
  // needs the pending count the sync just changed. Deferred to an animation
  // frame so the till paints before IndexedDB is opened (same reason as
  // install-prompt.tsx) and so this effect holds no synchronous setState.
  useEffect(() => {
    const frame = requestAnimationFrame(() => void readOffline());
    return () => cancelAnimationFrame(frame);
  }, [readOffline, isOffline]);

  // Prime the device WHILE IT STILL HAS A NETWORK.
  //
  // Nothing else fetches the snapshot on this screen: `drain` refreshes it
  // after an upload, which only ever happens once sales are already queued.
  // So a till that had never synced had no catalogue, no lease and no public
  // key, and going offline showed the empty "never primed" till no matter how
  // many times the cashier had opened the POS. Offline selling could not work
  // on a fresh device at all.
  //
  // Runs on every online visit to the POS, so the cached catalogue and the
  // 7-day lease both stay fresh for the next outage. Failure is deliberately
  // silent: the online till is fully functional without any of this, and an
  // error toast here would fire on every visit for a deployment that has not
  // configured offline mode.
  useEffect(() => {
    if (isOffline) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      void refreshSnapshot()
        .then(() => {
          if (!cancelled) return readOffline();
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [isOffline, readOffline]);

  // Auto-sync on reconnection. The browser `online` event and `useOffline`
  // flipping to false are different signals (the hook also clears after a
  // successful framework fetch), so both are wired rather than trusting one.
  //
  // `runSync` is held in a ref rather than listed as a dependency. It ends by
  // calling readOffline(), which stores a freshly built Map, so its identity
  // changes on every run -- as a dependency it re-ran this effect, which ran
  // the sync, which changed the identity again. The till span-looped while
  // online and never settled long enough to click a button in a dialog.
  const runSyncRef = useRef(runSync);
  useEffect(() => {
    runSyncRef.current = runSync;
  }, [runSync]);

  useEffect(() => {
    if (isOffline) return;
    const frame = requestAnimationFrame(() => void runSyncRef.current(false));
    const onOnline = () => void runSyncRef.current(false);
    window.addEventListener("online", onOnline);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("online", onOnline);
    };
  }, [isOffline]);

  // While anything is queued, keep trying: an outage that ends without an
  // `online` event (captive portal, flaky upstream) would otherwise leave the
  // day's takings sitting on the device until someone notices.
  useEffect(() => {
    const pending = offlineData?.pending ?? 0;
    if (pending === 0) return;
    const id = window.setInterval(() => void runSyncRef.current(false), 60_000);
    return () => window.clearInterval(id);
  }, [offlineData?.pending]);

  const offlineRows = useMemo<OfflineProductRow[]>(() => {
    if (!offlineData) return [];
    return offlineCatalogue(offlineData.products, offlineData.held, search);
  }, [offlineData, search]);

  const offlineGate = useMemo(
    () => (offlineData ? offlineSaleGate(offlineData.lease) : null),
    [offlineData]
  );

  // Derived once per decision change, not per render. Feeding the raw
  // expression straight to <Dialog open> remounted the dialog on every
  // render: Playwright never saw a stable button, and a cashier would have
  // watched it flicker.
  const leaseBlocked = useMemo(
    () => isOffline && !!offlineGate && !offlineGate.allowed && !pendingPeek,
    [isOffline, offlineGate, pendingPeek]
  );

  function addOfflineProduct(row: OfflineProductRow) {
    if (row.blocked) {
      toast.error(`${row.product.name}: ${row.blocked}`);
      return;
    }
    if (row.product.hasVariants) {
      setOfflinePicker(row.product);
      return;
    }
    const allowDecimal = unitsEnabled && row.product.allowDecimalQuantity;
    addLine(lineFromCached(row.product, row.stock, allowDecimal));
  }

  /**
   * Save the cart to this device instead of calling the Server Action.
   *
   * `createSale` is deliberately NOT called here: with `experimental.useOffline`
   * on, Next keeps a failed Server Action pending and replays it when the
   * network returns, which would race our own sync engine over the same sale
   * and book it twice.
   */
  async function completeOfflineSale() {
    if (!offlineData) {
      toast.error("This device has no offline catalogue yet. Reconnect once while online.");
      return;
    }
    if (offlineGate && !offlineGate.allowed) {
      // Blocks only NEW sales. Anything already queued stays queued and keeps
      // syncing — it is money that was already taken.
      toast.error(offlineGate.message);
      return;
    }

    const clientSaleId = (clientSaleIdRef.current ??= crypto.randomUUID());
    setOfflineSaving(true);
    try {
      const result = await recordOfflineSale(
        clientSaleId,
        {
          ...(customerName ? { customerName } : {}),
          ...(customerPhone ? { customerPhone } : {}),
          discountPercent,
          paymentMethod,
          items: cart.map((i) => ({
            productId: i.productId,
            ...(i.variantId ? { variantId: i.variantId } : {}),
            quantity: i.quantity,
          })),
        },
        // The amount actually charged, so the server can refuse a sale whose
        // price drifted rather than quietly charging a different figure.
        total
      );
      const described = describeRecordResult(result);
      if (!described.ok) {
        // NOT on disk: the cart stays on screen, because the page's memory is
        // now the only copy of this sale.
        toast.error(described.message);
        return;
      }

      clientSaleIdRef.current = null;
      setCart([]);
      setCustomerName("");
      setCustomerPhone("");
      setDiscountPercent(0);
      setPaymentMethod("CASH");
      toast.success(described.message);
      await readOffline();
    } finally {
      setOfflineSaving(false);
    }
  }

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

    // Offline the scan must resolve against the CACHED catalogue: the `products`
    // prop came from the last render while connected, so its stock figures do
    // not account for anything sold during this outage.
    if (isOffline) {
      for (const row of offlineRows) {
        const p = row.product;
        if (!p.hasVariants && (p.barcode === value || p.sku === value)) {
          addOfflineProduct(row);
          setSearch("");
          return;
        }
        const variant = p.variants.find((v) => v.sku === value || v.barcode === value);
        if (!variant) continue;
        if (row.blocked) {
          toast.error(`${p.name}: ${row.blocked}`);
          setSearch("");
          return;
        }
        addLine(
          lineFromCachedVariant(
            p,
            variant,
            row.variantStock.get(variant.id) ?? 0,
            unitsEnabled && p.allowDecimalQuantity
          )
        );
        setSearch("");
        return;
      }
      return;
    }

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

    // The ONLY offline divergence, and it returns before anything below runs:
    // when connected, every line after this point is the behaviour that shipped
    // (same action call, same expired-stock manager prompt, same receipt).
    if (isOffline) {
      void completeOfflineSale();
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

        {/* Connectivity, queue depth and a manual retry. Inside the existing
            column so nothing about the POS layout moves. */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs">
          <StatusBadge variant={isOffline ? "destructive" : "success"}>
            {isOffline ? (
              <>
                <CloudOff className="mr-1 size-3" />
                Offline
              </>
            ) : (
              "Online"
            )}
          </StatusBadge>
          <span className="text-muted-foreground">
            {(offlineData?.pending ?? 0) > 0
              ? `${offlineData?.pending} sale(s) waiting to sync`
              : "Nothing waiting to sync"}
          </span>
          <span className="text-muted-foreground">
            {lastSyncAt ? `Last sync ${lastSyncAt.toLocaleTimeString()}` : "No sync yet"}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto h-7"
            disabled={syncing}
            onClick={() => void runSync(true)}
          >
            <RefreshCw className={`mr-1 size-3 ${syncing ? "animate-spin" : ""}`} />
            Sync now
          </Button>
        </div>


        {useCachedCatalogue ? (
          offlineRows.length === 0 ? (
            <EmptyState
              icon={<CloudOff />}
              title={
                offlineData
                  ? "No cached products match your search"
                  : "This device has no catalogue stored yet"
              }
            />
          ) : (
            /* Text-only tiles: the cached catalogue carries no images on
               purpose (they would balloon the device cache), so there is
               nothing to render and no broken-image placeholder to show. */
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {offlineRows.map((row) => (
                <button
                  key={row.product.id}
                  type="button"
                  onClick={() => addOfflineProduct(row)}
                  disabled={row.stock <= 0 || !!row.blocked}
                  className="flex flex-col gap-0.5 rounded-xl border bg-card p-2.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
                >
                  <p className="truncate text-sm font-medium">{row.product.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    SKU {row.product.sku}
                    {row.product.barcode ? ` · ${row.product.barcode}` : ""}
                  </p>
                  {row.product.hasVariants && (
                    <p className="truncate text-xs text-muted-foreground">
                      {row.product.variants.length} variant(s)
                    </p>
                  )}
                  <p className="mt-0.5 text-sm font-semibold tabular-nums">
                    {formatCurrency(row.product.price, currency)}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {row.blocked
                      ? row.blocked
                      : row.stock > 0
                        ? `${row.stock} ${row.product.unit} available`
                        : "Out of stock"}
                  </p>
                </button>
              ))}
            </div>
          )
        ) : filteredProducts.length === 0 ? (
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

          <Button
            size="lg"
            disabled={isPending || offlineSaving || cart.length === 0}
            onClick={() => handleCompleteSale()}
          >
            {isPending || offlineSaving
              ? "Processing..."
              : `Complete Sale · ${formatCurrency(total, currency)}`}
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

      {/* Offline variant picker — same choice, text only, and the stock shown
          is already net of what the queue holds. */}
      <Dialog open={!!offlinePicker} onOpenChange={(open) => !open && setOfflinePicker(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{offlinePicker?.name}</DialogTitle>
            <DialogDescription>Choose a variant to add to the cart.</DialogDescription>
          </DialogHeader>
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {offlinePicker?.variants.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                This product has no cached variants.
              </p>
            )}
            {offlinePicker?.variants.map((variant) => {
              const row = offlineRows.find((r) => r.product.id === offlinePicker.id);
              const left = row?.variantStock.get(variant.id) ?? 0;
              return (
                <button
                  key={variant.id}
                  type="button"
                  disabled={left <= 0}
                  onClick={() => {
                    addLine(
                      lineFromCachedVariant(
                        offlinePicker,
                        variant,
                        left,
                        unitsEnabled && offlinePicker.allowDecimalQuantity
                      )
                    );
                    setOfflinePicker(null);
                  }}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary/50 disabled:pointer-events-none disabled:opacity-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{variant.label}</p>
                    <p className="text-xs text-muted-foreground">
                      SKU {variant.sku} · {left > 0 ? `${left} in stock` : "out of stock"}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatCurrency(variant.price, currency)}
                  </span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/*
        The five-day window has run out (or this device never had a permit).
        Modal, and deliberately with no dismiss: the cashier must not be able
        to click past it and keep ringing up sales the server will later
        refuse. `onOpenChange` is a no-op for the same reason -- Escape and a
        backdrop click do nothing.

        It blocks NEW sales only. The queue underneath is untouched, sync
        still runs, and "View pending sales" closes the dialog so the cashier
        can see what is still waiting. Nothing here deletes anything.
      */}
      <Dialog open={leaseBlocked} onOpenChange={() => {}}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Internet connection required</DialogTitle>
            <DialogDescription>
              Your offline access period has expired. Connect to the internet to verify your
              subscription and continue making sales. Your pending sales are saved on this device.
            </DialogDescription>
          </DialogHeader>

          {leaseDenied ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              This store&apos;s offline access is not active. Reconnecting will not restore it until
              the account is reactivated — contact the owner.
            </p>
          ) : offlineGate && !offlineGate.allowed ? (
            <p className="text-xs text-muted-foreground">{offlineGate.message}</p>
          ) : null}

          {offlineData && offlineData.pending > 0 ? (
            <p className="text-xs text-muted-foreground">
              {offlineData.pending} sale(s) saved on this device, waiting to be sent. They are kept
              until the server confirms them.
            </p>
          ) : null}

          <DialogFooter className="gap-2 sm:gap-2">
            {offlineData && offlineData.pending > 0 && (
              <Button variant="outline" onClick={() => setPendingPeek(true)}>
                View pending sales
              </Button>
            )}
            <Button onClick={() => void retryConnection()} disabled={renewing}>
              {renewing ? "Checking..." : "Retry connection"}
            </Button>
          </DialogFooter>
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
