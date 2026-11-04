"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
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
import { batchStatusLabel } from "@/lib/labels";
import type { ProductBatchView, BatchRow } from "@/lib/queries/batches";
import type { BatchExpiryState } from "@/lib/batches";

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
}

const EXPIRY_BADGE_CLASS: Record<BatchExpiryState, string> = {
  valid: "text-emerald-700 dark:text-emerald-400",
  expires_today: "text-amber-700 dark:text-amber-400",
  expired: "text-red-700 dark:text-red-400",
  missing_date: "text-red-700 dark:text-red-400",
};

/** Enable-tracking card, shown for an untracked product when the store feature is on. */
function EnableCard({ productId, hasVariants }: { productId: string; hasVariants: boolean }) {
  const t = useTranslations("batches.enableCard");
  const tCancel = useTranslations("batches");
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
      toast.success(res.alreadyEnabled ? t("toastAlreadyEnabled") : t("toastEnabled"));
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Boxes className="size-4" /> {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          {t.rich("body", {
            variantSuffix: hasVariants ? t("bodyVariantSuffix") : "",
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
          <br />
          {t.rich("cannotDisable", { strong: (chunks) => <strong>{chunks}</strong> })}
        </p>
        <Button onClick={() => setOpen(true)}>{t("enableButton")}</Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialog.title")}</DialogTitle>
            <DialogDescription>{t("dialog.description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              {tCancel("cancel")}
            </Button>
            <Button onClick={enable} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />} {t("dialog.confirm")}
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
  const t = useTranslations("batches.adjustDialog");
  const tCancel = useTranslations("batches");
  const [isPending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [newStock, setNewStock] = useState(String(batch.stock));
  const [reason, setReason] = useState("");

  function submit() {
    const value = Number(newStock);
    if (!Number.isFinite(value) || value < 0) return toast.error(t("errorInvalidQuantity"));
    if (!reason.trim()) return toast.error(t("errorReasonRequired"));
    start(async () => {
      const res = await adjustBatchStock({ batchId: batch.id, newStock: value, reason: reason.trim() });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      setReason("");
      toast.success(t("toastAdjusted"));
      onDone();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={batch.status === "ARCHIVED"}>
        <SlidersHorizontal className="size-3.5" /> {t("button")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title", { batchCode: batch.batchCode })}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="adj-stock">{t("countedStockLabel", { unit })}</FieldLabel>
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
              <FieldLabel htmlFor="adj-reason">{t("reasonLabel")}</FieldLabel>
              <Input id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reasonPlaceholder")} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>{tCancel("cancel")}</Button>
            <Button onClick={submit} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />} {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReceiveForm({ view, onDone }: { view: ProductBatchView; onDone: () => void }) {
  const t = useTranslations("batches.receiveForm");
  const [isPending, start] = useTransition();
  const [variantId, setVariantId] = useState(view.hasVariants ? view.variants[0]?.id ?? "" : "");
  const [batchCode, setBatchCode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  function submit() {
    const qty = Number(quantity);
    if (!batchCode.trim()) return toast.error(t("errorBatchCodeRequired"));
    if (!Number.isFinite(qty) || qty <= 0) return toast.error(t("errorQuantityPositive"));
    if (view.hasVariants && !variantId) return toast.error(t("errorChooseVariant"));
    if (view.trackExpiry && !expiryDate) return toast.error(t("errorExpiryRequired"));
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
      toast.success(res.reused ? t("toastReused") : t("toastReceived"));
      onDone();
    });
  }

  // Every batch on a variant product must name a variant, so with none created
  // the form can only ever end in "Choose a variant." from an empty dropdown.
  if (view.hasVariants && view.variants.length === 0) {
    return (
      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 flex items-center gap-2 text-sm font-medium">
          <PackagePlus className="size-4" /> {t("title")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("needVariantFirst")}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium">
        <PackagePlus className="size-4" /> {t("title")}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {view.hasVariants && (
          <Field>
            <FieldLabel>{t("variantLabel")}</FieldLabel>
            <Select value={variantId} onValueChange={setVariantId}>
              <SelectTrigger><SelectValue placeholder={t("variantPlaceholder")} /></SelectTrigger>
              <SelectContent>
                {view.variants.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="rc-code">{t("batchCodeLabel")}</FieldLabel>
          <Input id="rc-code" value={batchCode} onChange={(e) => setBatchCode(e.target.value)} placeholder={t("batchCodePlaceholder")} />
        </Field>
        <Field>
          <FieldLabel htmlFor="rc-qty">{t("quantityLabel", { unit: view.unit })}</FieldLabel>
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
          <FieldLabel htmlFor="rc-cost">{t("costPriceLabel")}</FieldLabel>
          <Input id="rc-cost" type="number" min={0} step="0.01" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
        </Field>
        {view.trackExpiry && (
          <Field>
            <FieldLabel htmlFor="rc-exp">{t("expiryDateLabel")}</FieldLabel>
            <Input id="rc-exp" type="date" min={view.storeToday} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </Field>
        )}
      </div>
      <Button className="mt-3" onClick={submit} disabled={isPending}>
        {isPending && <Loader2 className="size-4 animate-spin" />} {t("receiveButton")}
      </Button>
    </div>
  );
}

/** Correct a single batch's expiry date (trackExpiry products only). */
function ExpiryEditDialog({ batch, storeToday, onDone }: { batch: BatchRow; storeToday: string; onDone: () => void }) {
  const t = useTranslations("batches.expiryEditDialog");
  const tCancel = useTranslations("batches");
  const [isPending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(batch.expiryDate ?? "");

  function submit() {
    if (!date) return toast.error(t("errorDateRequired"));
    start(async () => {
      const res = await updateBatchExpiryDate({ batchId: batch.id, expiryDate: date });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      toast.success(t("toastUpdated"));
      onDone();
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <CalendarClock className="size-3.5" /> {t("button")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title", { batchCode: batch.batchCode })}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="ed-date">{t("dateLabel")}</FieldLabel>
            <Input id="ed-date" type="date" min={batch.stock > 0 ? storeToday : undefined} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>{tCancel("cancel")}</Button>
            <Button onClick={submit} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />} {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Card to activate expiry tracking on an already batch-tracked product. */
function EnableExpiryCard({ view, onDone }: { view: ProductBatchView; onDone: () => void }) {
  const t = useTranslations("batches.enableExpiryCard");
  const tCancel = useTranslations("batches");
  const [isPending, start] = useTransition();
  const [open, setOpen] = useState(false);
  // Positive-stock, non-archived batches all need a date.
  const needDates = view.batches.filter((b) => b.status !== "ARCHIVED" && b.stock > 0);
  const [dates, setDates] = useState<Record<string, string>>(() =>
    Object.fromEntries(needDates.map((b) => [b.id, b.expiryDate ?? ""]))
  );

  function submit() {
    const assignments = needDates.map((b) => ({ batchId: b.id, expiryDate: dates[b.id] ?? "" }));
    if (assignments.some((a) => !a.expiryDate)) return toast.error(t("errorAllDatesRequired"));
    start(async () => {
      const res = await enableProductExpiryTracking({ productId: view.productId, assignments });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      toast.success(res.alreadyEnabled ? t("toastAlreadyOn") : t("toastEnabled"));
      onDone();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4" /> {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="mb-3 list-disc pl-5 text-sm text-muted-foreground">
          <li>{t("bullet1")}</li>
          <li>{t("bullet2")}</li>
          <li>{t.rich("bullet3", { strong: (chunks) => <strong>{chunks}</strong> })}</li>
        </ul>
        <Button onClick={() => setOpen(true)}>{t("enableButton")}</Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("dialog.title")}</DialogTitle>
            <DialogDescription>{t("dialog.description")}</DialogDescription>
          </DialogHeader>
          {needDates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("dialog.noneNeeded")}</p>
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
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>{tCancel("cancel")}</Button>
            <Button onClick={submit} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />} {t("dialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Archive (terminally retire) a batch. Stock is not changed by archiving. */
function ArchiveDialog({ batch, onDone }: { batch: BatchRow; onDone: () => void }) {
  const t = useTranslations("batches.archiveDialog");
  const tCancel = useTranslations("batches");
  const [isPending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  function submit() {
    if (!reason.trim()) return toast.error(t("errorReasonRequired"));
    start(async () => {
      const res = await archiveBatch({ batchId: batch.id, reason: reason.trim() });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      toast.success(t("toastArchived"));
      onDone();
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} disabled={batch.status === "ARCHIVED"}>
        <Archive className="size-3.5" /> {t("button")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title", { batchCode: batch.batchCode })}</DialogTitle>
            <DialogDescription>
              {t.rich("description", {
                quantity: fmt(batch.stock),
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="ar-reason">{t("reasonLabel")}</FieldLabel>
            <Input id="ar-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reasonPlaceholder")} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>{tCancel("cancel")}</Button>
            <Button onClick={submit} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />} {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Danger-zone card to revert a tracked product back to a simple product. */
function DisableTrackingCard({ view, onDone }: { view: ProductBatchView; onDone: () => void }) {
  const t = useTranslations("batches.disableTrackingCard");
  const tCancel = useTranslations("batches");
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
      toast.success(t("toastDisabled"));
      onDone();
    });
  }

  return (
    <div className="rounded-lg border border-destructive/30 p-3">
      <p className="mb-1 flex items-center gap-2 text-sm font-medium text-destructive">
        <PowerOff className="size-4" /> {t("title")}
      </p>
      <p className="mb-3 text-xs text-muted-foreground">
        {t("description")}
      </p>
      <Button variant="outline" onClick={() => setOpen(true)}>{t("button")}</Button>

      <Dialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialog.title")}</DialogTitle>
            <DialogDescription>
              {t("dialog.description")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>{tCancel("cancel")}</Button>
            <Button onClick={submit} disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />} {t("dialog.confirm")}
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
  const t = useTranslations("batches.manager");
  const tExpiryBadge = useTranslations("batches.expiryBadge");
  const tLabels = useTranslations("labels");
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
          <Boxes className="size-4" /> {t("title")}
        </CardTitle>
        <CardDescription>
          {view.trackExpiry ? t("descriptionExpiry") : t("descriptionFifo")}
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
            t("reconciled")
          ) : (
            <span>
              {t("mismatchPrefix")}{" "}
              {view.reconciliation.lines
                .filter((l) => !l.reconciled)
                .map((l) => t("mismatchLine", { label: l.label, aggregate: fmt(l.aggregateStock), batchTotal: fmt(l.batchTotal) }))
                .join("; ")}
            </span>
          )}
        </div>

        <ReceiveForm view={view} onDone={refresh} />

        {view.batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noBatchesYet")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3">{t("table.batch")}</th>
                  {view.hasVariants && <th className="py-2 pr-3">{t("table.variant")}</th>}
                  <th className="py-2 pr-3">{t("table.received")}</th>
                  {view.trackExpiry && <th className="py-2 pr-3">{t("table.expiry")}</th>}
                  <th className="py-2 pr-3">{t("table.stock")}</th>
                  <th className="py-2 pr-3">{t("table.cost")}</th>
                  <th className="py-2 pr-3">{t("table.status")}</th>
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
                        <span className={`text-xs ${EXPIRY_BADGE_CLASS[b.expiryState]}`}>
                          {tExpiryBadge(b.expiryState)}
                        </span>
                      </td>
                    )}
                    <td className="py-2 pr-3">{fmt(b.stock)} {view.unit}</td>
                    <td className="py-2 pr-3">{b.costPrice != null ? b.costPrice.toFixed(2) : "—"}</td>
                    <td className="py-2 pr-3">{batchStatusLabel(tLabels, b.status)}</td>
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
