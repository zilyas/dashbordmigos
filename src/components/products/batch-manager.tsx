"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, PackagePlus, SlidersHorizontal, CheckCircle2, AlertTriangle, Boxes, CalendarClock, Archive, PowerOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  enableProductBatchTracking,
  receiveBatchStock,
  adjustBatchStock,
  enableProductExpiryTracking,
  updateBatchExpiryDate,
  archiveBatch,
  disableProductBatchTracking,
} from "@/actions/batches";
import { cn } from "@/lib/utils";
import type { ProductBatchView, BatchRow } from "@/lib/queries/batches";
import type { BatchExpiryState } from "@/lib/batches";

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
}

const EXPIRY_BADGE: Record<BatchExpiryState, { label: string; className: string }> = {
  valid: { label: "Valid", className: "text-emerald-700 dark:text-emerald-400" },
  expires_today: { label: "Expires today", className: "text-amber-700 dark:text-amber-400" },
  expired: { label: "Expired", className: "text-red-700 dark:text-red-400" },
  missing_date: { label: "No date", className: "text-red-700 dark:text-red-400" },
};

/** Enable-tracking card, shown for an untracked product when the store feature is on. */
function EnableCard({ productId, hasVariants }: { productId: string; hasVariants: boolean }) {
  const [isPending, start] = useTransition();
  const [open, setOpen] = useState(false);

  function enable() {
    start(async () => {
      const res = await enableProductBatchTracking({ productId });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      toast.success(
        res.alreadyEnabled ? "Batch tracking already enabled." : "Batch tracking enabled — opening stock captured."
      );
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Boxes className="size-4" /> Batch &amp; lot tracking
        </CardTitle>
        <CardDescription>
          Track stock as dated lots/batches with automatic oldest-first (FIFO) allocation on sales.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          Enabling this captures the product&apos;s current stock
          {hasVariants ? " (per variant)" : ""} as an <strong>Opening</strong> batch, then all future
          stock changes go through batch receiving and adjustments. Aggregate stock is preserved.
          <br />
          Tracking <strong>cannot be turned off</strong> in this release, so enable it deliberately.
        </p>
        <Button onClick={() => setOpen(true)}>Enable batch tracking…</Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enable batch tracking?</DialogTitle>
            <DialogDescription>
              Current stock becomes an Opening batch. This can&apos;t be undone in this release.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={enable} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />} Enable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AdjustDialog({
  batch,
  unit,
  allowDecimalQuantity,
  onDone,
}: {
  batch: BatchRow;
  unit: string;
  allowDecimalQuantity: boolean;
  onDone: () => void;
}) {
  const [isPending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [newStock, setNewStock] = useState(String(batch.stock));
  const [reason, setReason] = useState("");

  function submit() {
    const value = Number(newStock);
    if (!Number.isFinite(value) || value < 0) return toast.error("Enter a valid non-negative quantity.");
    if (!reason.trim()) return toast.error("A reason is required.");
    start(async () => {
      const res = await adjustBatchStock({ batchId: batch.id, newStock: value, reason: reason.trim() });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      setReason("");
      toast.success("Batch stock adjusted.");
      onDone();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={batch.status === "ARCHIVED"}>
        <SlidersHorizontal className="size-3.5" /> Adjust
      </Button>
      <Dialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust counted stock — {batch.batchCode}</DialogTitle>
            <DialogDescription>Enter the counted quantity; the difference is logged.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="adj-stock">Counted stock ({unit})</FieldLabel>
              <Input
                id="adj-stock"
                type="number"
                min={0}
                step={allowDecimalQuantity ? "0.001" : "1"}
                value={newStock}
                onChange={(e) => setNewStock(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="adj-reason">Reason</FieldLabel>
              <Input id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. stock count correction" />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
            <Button onClick={submit} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />} Save adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReceiveForm({ view, onDone }: { view: ProductBatchView; onDone: () => void }) {
  const [isPending, start] = useTransition();
  const [variantId, setVariantId] = useState(view.hasVariants ? view.variants[0]?.id ?? "" : "");
  const [batchCode, setBatchCode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  function submit() {
    const qty = Number(quantity);
    if (!batchCode.trim()) return toast.error("Enter a batch code.");
    if (!Number.isFinite(qty) || qty <= 0) return toast.error("Quantity must be greater than zero.");
    if (view.hasVariants && !variantId) return toast.error("Choose a variant.");
    if (view.trackExpiry && !expiryDate) return toast.error("Enter an expiry date.");
    start(async () => {
      const res = await receiveBatchStock({
        productId: view.productId,
        variantId: view.hasVariants ? variantId : "",
        batchCode: batchCode.trim(),
        quantity: qty,
        costPrice: costPrice ? Number(costPrice) : undefined,
        expiryDate: view.trackExpiry ? expiryDate : "",
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setBatchCode("");
      setQuantity("");
      setCostPrice("");
      setExpiryDate("");
      toast.success(res.reused ? "Stock added to existing batch." : "New batch received.");
      onDone();
    });
  }

  // Every batch on a variant product must name a variant, so with none created
  // the form can only ever end in "Choose a variant." from an empty dropdown.
  if (view.hasVariants && view.variants.length === 0) {
    return (
      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 flex items-center gap-2 text-sm font-medium">
          <PackagePlus className="size-4" /> Receive stock
        </p>
        <p className="text-sm text-muted-foreground">
          Add at least one variant above before receiving stock — every batch belongs to a variant.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium">
        <PackagePlus className="size-4" /> Receive stock
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {view.hasVariants && (
          <Field>
            <FieldLabel>Variant</FieldLabel>
            <Select value={variantId} onValueChange={setVariantId}>
              <SelectTrigger><SelectValue placeholder="Choose variant" /></SelectTrigger>
              <SelectContent>
                {view.variants.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="rc-code">Batch code</FieldLabel>
          <Input id="rc-code" value={batchCode} onChange={(e) => setBatchCode(e.target.value)} placeholder="e.g. LOT-2026-01" />
        </Field>
        <Field>
          <FieldLabel htmlFor="rc-qty">Quantity ({view.unit})</FieldLabel>
          <Input
            id="rc-qty"
            type="number"
            min={0}
            step={view.allowDecimalQuantity ? "0.001" : "1"}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="rc-cost">Cost price (optional)</FieldLabel>
          <Input id="rc-cost" type="number" min={0} step="0.01" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
        </Field>
        {view.trackExpiry && (
          <Field>
            <FieldLabel htmlFor="rc-exp">Expiry date</FieldLabel>
            <Input id="rc-exp" type="date" min={view.storeToday} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </Field>
        )}
      </div>
      <Button className="mt-3" onClick={submit} disabled={isPending}>
        {isPending && <Loader2 className="size-4 animate-spin" />} Receive
      </Button>
    </div>
  );
}

/** Correct a single batch's expiry date (trackExpiry products only). */
function ExpiryEditDialog({ batch, storeToday, onDone }: { batch: BatchRow; storeToday: string; onDone: () => void }) {
  const [isPending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(batch.expiryDate ?? "");

  function submit() {
    if (!date) return toast.error("Enter a date.");
    start(async () => {
      const res = await updateBatchExpiryDate({ batchId: batch.id, expiryDate: date });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      toast.success("Expiry date updated.");
      onDone();
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <CalendarClock className="size-3.5" /> Date
      </Button>
      <Dialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Correct expiry date — {batch.batchCode}</DialogTitle>
            <DialogDescription>A batch with stock cannot be set to a past date.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="ed-date">Expiry date</FieldLabel>
            <Input id="ed-date" type="date" min={batch.stock > 0 ? storeToday : undefined} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
            <Button onClick={submit} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Card to activate expiry tracking on an already batch-tracked product. */
function EnableExpiryCard({ view, onDone }: { view: ProductBatchView; onDone: () => void }) {
  const [isPending, start] = useTransition();
  const [open, setOpen] = useState(false);
  // Positive-stock, non-archived batches all need a date.
  const needDates = view.batches.filter((b) => b.status !== "ARCHIVED" && b.stock > 0);
  const [dates, setDates] = useState<Record<string, string>>(() =>
    Object.fromEntries(needDates.map((b) => [b.id, b.expiryDate ?? ""]))
  );

  function submit() {
    const assignments = needDates.map((b) => ({ batchId: b.id, expiryDate: dates[b.id] ?? "" }));
    if (assignments.some((a) => !a.expiryDate)) return toast.error("Give every batch an expiry date.");
    start(async () => {
      const res = await enableProductExpiryTracking({ productId: view.productId, assignments });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      toast.success(res.alreadyEnabled ? "Expiry tracking already on." : "Expiry tracking enabled.");
      onDone();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4" /> Expiry tracking
        </CardTitle>
        <CardDescription>Track a use-by date per batch and block selling expired stock.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="mb-3 list-disc pl-5 text-sm text-muted-foreground">
          <li>Every current batch with stock needs an expiry date.</li>
          <li>Expired batches can&apos;t be sold; a batch expiring today is sellable all day.</li>
          <li>Expiry tracking <strong>cannot be disabled</strong> in this release.</li>
        </ul>
        <Button onClick={() => setOpen(true)}>Enable expiry tracking…</Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign expiry dates</DialogTitle>
            <DialogDescription>Set a date for each batch that currently has stock.</DialogDescription>
          </DialogHeader>
          {needDates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No batches with stock — you can enable directly.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {needDates.map((b) => (
                <div key={b.id} className="flex items-center gap-2">
                  <span className="w-40 shrink-0 text-sm">
                    {b.batchCode}
                    {b.variantLabel ? ` · ${b.variantLabel}` : ""} ({fmt(b.stock)} {view.unit})
                  </span>
                  <Input
                    type="date"
                    min={view.storeToday}
                    value={dates[b.id] ?? ""}
                    onChange={(e) => setDates((d) => ({ ...d, [b.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
            <Button onClick={submit} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />} Enable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Archive (terminally retire) a batch. Stock is not changed by archiving. */
function ArchiveDialog({ batch, onDone }: { batch: BatchRow; onDone: () => void }) {
  const [isPending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  function submit() {
    if (!reason.trim()) return toast.error("A reason is required.");
    start(async () => {
      const res = await archiveBatch({ batchId: batch.id, reason: reason.trim() });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      toast.success("Batch archived.");
      onDone();
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} disabled={batch.status === "ARCHIVED"}>
        <Archive className="size-3.5" /> Archive
      </Button>
      <Dialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive batch {batch.batchCode}?</DialogTitle>
            <DialogDescription>
              Archiving retires this batch so it can no longer be sold or received. It{" "}
              <strong>does not change its stock</strong> — if you mean to write off {fmt(batch.stock)} unit(s),
              adjust the batch to 0 first. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="ar-reason">Reason</FieldLabel>
            <Input id="ar-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. damaged / recalled" />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
            <Button onClick={submit} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />} Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Danger-zone card to revert a tracked product back to a simple product. */
function DisableTrackingCard({ view, onDone }: { view: ProductBatchView; onDone: () => void }) {
  const [isPending, start] = useTransition();
  const [open, setOpen] = useState(false);

  function submit() {
    start(async () => {
      const res = await disableProductBatchTracking(view.productId);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      toast.success("Batch tracking disabled — product is now a simple product.");
      onDone();
    });
  }

  return (
    <div className="rounded-lg border border-destructive/30 p-3">
      <p className="mb-1 flex items-center gap-2 text-sm font-medium text-destructive">
        <PowerOff className="size-4" /> Disable batch tracking
      </p>
      <p className="mb-3 text-xs text-muted-foreground">
        Turns this back into a simple product. Existing batches are archived (kept for history,
        no longer sellable), current total stock is preserved as a plain number, and you can edit
        stock directly again. You can re-enable tracking later (a new Opening batch is captured).
      </p>
      <Button variant="outline" onClick={() => setOpen(true)}>Disable batch tracking…</Button>

      <Dialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable batch tracking?</DialogTitle>
            <DialogDescription>
              Existing batches will be archived and this product reverts to a simple product with its
              current total stock preserved. Tracking can be re-enabled later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
            <Button onClick={submit} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />} Disable tracking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Manager batch-inventory section (below ProductForm/VariantManager, like
 * VariantManager itself). Only rendered when the store's batch feature is on.
 */
export function BatchManager({ view }: { view: ProductBatchView }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  if (!view.trackBatch) {
    return <EnableCard productId={view.productId} hasVariants={view.hasVariants} />;
  }

  const reconciled = view.reconciliation.ok;

  return (
    <div key={refreshKey} className="flex flex-col gap-6">
    {!view.trackExpiry && <EnableExpiryCard view={view} onDone={refresh} />}
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Boxes className="size-4" /> Batch inventory
        </CardTitle>
        <CardDescription>
          Stock is tracked per batch. Sales allocate {view.trackExpiry ? "the earliest-expiring" : "the oldest"} batch first automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
            reconciled
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          }`}
        >
          {reconciled ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
          {reconciled ? (
            "Aggregate stock reconciles with batch totals."
          ) : (
            <span>
              Reconciliation mismatch:{" "}
              {view.reconciliation.lines
                .filter((l) => !l.reconciled)
                .map((l) => `${l.label} (agg ${fmt(l.aggregateStock)} vs batches ${fmt(l.batchTotal)})`)
                .join("; ")}
            </span>
          )}
        </div>

        <ReceiveForm view={view} onDone={refresh} />

        {view.batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No batches yet. Receive stock to create one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3">Batch</th>
                  {view.hasVariants && <th className="py-2 pr-3">Variant</th>}
                  <th className="py-2 pr-3">Received</th>
                  {view.trackExpiry && <th className="py-2 pr-3">Expiry</th>}
                  <th className="py-2 pr-3">Stock</th>
                  <th className="py-2 pr-3">Cost</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {view.batches.map((b) => (
                  <tr key={b.id} className={cn("border-b border-border/60", b.status === "ARCHIVED" && "opacity-50")}>
                    <td className="py-2 pr-3 font-medium">{b.batchCode}</td>
                    {view.hasVariants && <td className="py-2 pr-3">{b.variantLabel ?? "—"}</td>}
                    <td className="py-2 pr-3">{new Date(b.receivedAt).toLocaleDateString()}</td>
                    {view.trackExpiry && (
                      <td className="py-2 pr-3">
                        <span className="tabular-nums">{b.expiryDate ?? "—"}</span>{" "}
                        <span className={`text-xs ${EXPIRY_BADGE[b.expiryState].className}`}>
                          {EXPIRY_BADGE[b.expiryState].label}
                        </span>
                      </td>
                    )}
                    <td className="py-2 pr-3">{fmt(b.stock)} {view.unit}</td>
                    <td className="py-2 pr-3">{b.costPrice != null ? b.costPrice.toFixed(2) : "—"}</td>
                    <td className="py-2 pr-3">{b.status}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {view.trackExpiry && b.status !== "ARCHIVED" && (
                        <ExpiryEditDialog batch={b} storeToday={view.storeToday} onDone={refresh} />
                      )}
                      <AdjustDialog
                        batch={b}
                        unit={view.unit}
                        allowDecimalQuantity={view.allowDecimalQuantity}
                        onDone={refresh}
                      />
                      <ArchiveDialog batch={b} onDone={refresh} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DisableTrackingCard view={view} onDone={refresh} />
      </CardContent>
    </Card>
    </div>
  );
}
