"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Plus, Layers, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ImageUploader } from "@/components/products/image-uploader";
import { StatusBadge } from "@/components/shared/status-badge";
import { createVariant, updateVariant, deleteVariant } from "@/actions/variants";
import { buildVariantSchema, type VariantInput } from "@/lib/validations/variant";
import type { ProductVariantItem } from "@/lib/queries/products";

const NONE = "none";

type Option = { id: string; name: string };

type Axis = { key: string; label: string };

export function VariantManager({
  productId,
  variants,
  sizes,
  colors,
  allowDecimal = false,
  axes = [],
}: {
  productId: string;
  variants: ProductVariantItem[];
  sizes: Option[];
  colors: Option[];
  /** Product sells in decimal quantities — allow fractional variant stock. */
  allowDecimal?: boolean;
  /** Store's custom variant axes (empty unless custom_variant_axes_enabled). */
  axes?: Axis[];
}) {
  const t = useTranslations("products.variants");
  const tCommon = useTranslations("common");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProductVariantItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProductVariantItem | null>(null);

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>{t("cardTitle")}</CardTitle>
            <CardDescription>{t("cardDescription")}</CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-4" />
            {t("addVariant")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {variants.length === 0 ? (
          <EmptyState
            icon={<Layers />}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        ) : (
          <div className="flex flex-col divide-y">
            {variants.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-3 py-2.5">
                {/* The image was already stored per variant but never rendered,
                    so a photo you uploaded looked like it had been lost. */}
                <div className="relative size-10 shrink-0 overflow-hidden rounded-md border bg-muted">
                  {v.imageUrl ? (
                    <Image src={v.imageUrl} alt={v.sku} fill className="object-cover" sizes="40px" />
                  ) : (
                    <Layers className="absolute inset-0 m-auto size-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {[v.sizeName, v.colorName, ...axes.map((a) => v.axisValues[a.key]).filter(Boolean)]
                      .filter(Boolean)
                      .join(" / ") || v.sku}
                    {!v.isActive && <span className="ml-2 text-xs text-muted-foreground">{t("inactive")}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("skuStockLine", { sku: v.sku, stock: v.stock })}
                    {v.sellingPrice != null ? t("priceSuffix", { price: v.sellingPrice }) : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <StatusBadge variant={v.stock > 0 ? "success" : "neutral"}>
                    {v.stock > 0 ? t("inStock") : t("empty")}
                  </StatusBadge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      setEditing(v);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(v)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <VariantDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        productId={productId}
        variant={editing}
        sizes={sizes}
        colors={colors}
        allowDecimal={allowDecimal}
        axes={axes}
      />

      {deleteTarget && (
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title={t("deleteTitle")}
          description={t("deleteDescription")}
          confirmLabel={tCommon("delete")}
          destructive
          onConfirm={async () => {
            const result = await deleteVariant(deleteTarget.id);
            if (result?.error) toast.error(result.error);
            else toast.success(result?.archived ? t("toastDeactivated") : t("toastDeleted"));
          }}
        />
      )}
    </Card>
  );
}

function VariantDialog({
  open,
  onOpenChange,
  productId,
  variant,
  sizes,
  colors,
  allowDecimal,
  axes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  variant: ProductVariantItem | null;
  sizes: Option[];
  colors: Option[];
  allowDecimal: boolean;
  axes: Axis[];
}) {
  const [isPending, startTransition] = useTransition();
  // Custom axis values live outside RHF (dynamic keys), merged in on submit.
  const [axisVals, setAxisVals] = useState<Record<string, string>>(() => ({ ...(variant?.axisValues ?? {}) }));
  const setAxis = (key: string, value: string) => setAxisVals((prev) => ({ ...prev, [key]: value }));
  const t = useTranslations("products.variants.dialog");
  const tCommon = useTranslations("common");
  const tValidation = useTranslations("validation");
  const variantSchema = useMemo(() => buildVariantSchema(tValidation), [tValidation]);

  const form = useForm<VariantInput>({
    resolver: zodResolver(variantSchema),
    values: {
      sizeId: variant?.sizeId ?? "",
      colorId: variant?.colorId ?? "",
      sku: variant?.sku ?? "",
      barcode: variant?.barcode ?? "",
      sellingPrice: variant?.sellingPrice ?? null,
      fabricationPrice: variant?.fabricationPrice ?? null,
      stock: variant?.stock ?? 0,
      isActive: variant?.isActive ?? true,
      imageUrl: variant?.imageUrl ?? "",
    },
  });

  function onSubmit(values: VariantInput) {
    const payload: VariantInput = {
      ...values,
      axisValues: axes.length > 0 ? Object.fromEntries(axes.map((a) => [a.key, axisVals[a.key] ?? ""])) : undefined,
    };
    startTransition(async () => {
      const result = variant
        ? await updateVariant(variant.id, payload)
        : await createVariant(productId, payload);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(variant ? t("toastUpdated") : t("toastCreated"));
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{variant ? t("editTitle") : t("newTitle")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>{t("sizeLabel")}</FieldLabel>
                <Controller
                  control={form.control}
                  name="sizeId"
                  render={({ field }) => (
                    <Select
                      value={field.value || NONE}
                      onValueChange={(v) => field.onChange(v === NONE ? "" : v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("none")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{t("none")}</SelectItem>
                        {sizes.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field>
                <FieldLabel>{t("colorLabel")}</FieldLabel>
                <Controller
                  control={form.control}
                  name="colorId"
                  render={({ field }) => (
                    <Select
                      value={field.value || NONE}
                      onValueChange={(v) => field.onChange(v === NONE ? "" : v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("none")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{t("none")}</SelectItem>
                        {colors.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>

            {axes.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {axes.map((axis) => (
                  <Field key={axis.key}>
                    <FieldLabel htmlFor={`v-axis-${axis.key}`}>{axis.label}</FieldLabel>
                    <Input
                      id={`v-axis-${axis.key}`}
                      value={axisVals[axis.key] ?? ""}
                      onChange={(e) => setAxis(axis.key, e.target.value)}
                      placeholder={t("axisPlaceholder", { label: axis.label })}
                    />
                  </Field>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field data-invalid={!!form.formState.errors.sku}>
                <FieldLabel htmlFor="v-sku">{t("skuLabel")}</FieldLabel>
                <Input id="v-sku" {...form.register("sku")} />
                {form.formState.errors.sku && <FieldError>{form.formState.errors.sku.message}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor="v-barcode">{t("barcodeLabel")}</FieldLabel>
                <Input id="v-barcode" {...form.register("barcode")} />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field>
                <FieldLabel htmlFor="v-price">{t("priceOverrideLabel")}</FieldLabel>
                <Input
                  id="v-price"
                  type="number"
                  step="0.01"
                  placeholder="—"
                  {...form.register("sellingPrice", {
                    setValueAs: (v) => (v === "" || v == null ? null : Number(v)),
                  })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="v-cost">{t("costOverrideLabel")}</FieldLabel>
                <Input
                  id="v-cost"
                  type="number"
                  step="0.01"
                  placeholder="—"
                  {...form.register("fabricationPrice", {
                    setValueAs: (v) => (v === "" || v == null ? null : Number(v)),
                  })}
                />
              </Field>
              <Field data-invalid={!!form.formState.errors.stock}>
                <FieldLabel htmlFor="v-stock">{t("stockLabel")}</FieldLabel>
                <Input
                  id="v-stock"
                  type="number"
                  step={allowDecimal ? "0.001" : "1"}
                  {...form.register("stock", { valueAsNumber: true })}
                />
                {form.formState.errors.stock && <FieldError>{form.formState.errors.stock.message}</FieldError>}
              </Field>
            </div>

            <Controller
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-2.5">
                  <span className="text-sm font-medium">{t("activeLabel")}</span>
                  <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                </div>
              )}
            />

            <Field>
              <FieldLabel>{t("imageLabel")}</FieldLabel>
              <Controller
                control={form.control}
                name="imageUrl"
                render={({ field }) => (
                  <ImageUploader
                    max={1}
                    value={field.value ? [field.value] : []}
                    onChange={(urls) => field.onChange(urls[0] ?? "")}
                  />
                )}
              />
            </Field>
          </FieldGroup>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {variant ? t("saveVariant") : t("createVariant")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
