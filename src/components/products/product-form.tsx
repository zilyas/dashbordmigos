"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Boxes, Check, ChevronDown, Loader2, Package, Scale } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { ImageUploader } from "@/components/products/image-uploader";
import { createProduct, updateProduct } from "@/actions/products";
import {
  buildProductSchema,
  type ProductInput,
  PRODUCT_UNITS,
} from "@/lib/validations/product";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CategoryListItem } from "@/lib/queries/categories";
import type { ColorListItem } from "@/lib/queries/colors";
import type { SizeListItem } from "@/lib/queries/sizes";

const NO_CATEGORY = "none";

export function ProductForm({
  categories,
  colors = [],
  sizes = [],
  productId,
  defaultValues,
  unitsEnabled = false,
  attributesEnabled = false,
}: {
  categories: CategoryListItem[];
  /** The store's color vocabulary (/colors). Only used while creating. */
  colors?: ColorListItem[];
  /** The store's size vocabulary (/sizes). Only used while creating. */
  sizes?: SizeListItem[];
  productId?: string;
  defaultValues?: Partial<ProductInput>;
  /** Store has units_enabled — show unit-based selling options. */
  unitsEnabled?: boolean;
  /** Store has category_attributes_enabled — show category specifications. */
  attributesEnabled?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("products.form");
  const tUnit = useTranslations("products.unit");
  const tCommon = useTranslations("common");
  const tValidation = useTranslations("validation");
  const productSchema = useMemo(() => buildProductSchema(tValidation), [tValidation]);

  // Attribute values live outside RHF (keyed by definition id) and are merged
  // into the payload on submit.
  // Off by default: a variant product does not have to vary by color.
  const [colorsOn, setColorsOn] = useState(false);
  // Same idea for sizes: a variant product does not have to vary by size.
  const [sizesOn, setSizesOn] = useState(false);

  const [attrValues, setAttrValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((defaultValues?.attributes ?? []).map((a) => [a.definitionId, a.value]))
  );
  const setAttr = (definitionId: string, value: string) =>
    setAttrValues((prev) => ({ ...prev, [definitionId]: value }));

  const form = useForm<ProductInput>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: "",
      sku: "",
      barcode: "",
      description: "",
      categoryId: "",
      type: "",
      size: "",
      color: "",
      fabricationPrice: 0,
      sellingPrice: 0,
      stock: 0,
      minimumStock: 5,
      status: "ACTIVE",
      images: [],
      hasVariants: false,
      unit: "piece",
      allowDecimalQuantity: false,
      colorIds: [],
      sizeIds: [],
      ...defaultValues,
    },
  });

  const hasVariants = useWatch({ control: form.control, name: "hasVariants" });
  const allowDecimalQuantity = useWatch({ control: form.control, name: "allowDecimalQuantity" });
  const selectedUnit = useWatch({ control: form.control, name: "unit" }) ?? "piece";
  const categoryId = useWatch({ control: form.control, name: "categoryId" });

  const colorIds = useWatch({ control: form.control, name: "colorIds" }) ?? [];
  const sizeIds = useWatch({ control: form.control, name: "sizeIds" }) ?? [];

  // Sizes and colors are combined as a cross product on the server, so this is
  // exactly how many variants the save will create.
  const variantCount = Math.max(1, sizeIds.length) * Math.max(1, colorIds.length);

  // The three tiles are the real mode switch; the fields below only reflect
  // whichever one is active. "Measured" is a non-piece unit, which is what
  // makes the quantity fields accept 0.5 kg.
  const setupMode: "simple" | "measured" | "variants" = hasVariants
    ? "variants"
    : unitsEnabled && selectedUnit !== "piece"
      ? "measured"
      : "simple";

  function chooseSetup(mode: "simple" | "measured" | "variants") {
    form.setValue("hasVariants", mode === "variants");
    if (mode === "variants") return;
    // Colors and sizes only exist as variants, so leaving the variant mode
    // drops them.
    form.setValue("colorIds", []);
    form.setValue("sizeIds", []);
    setColorsOn(false);
    setSizesOn(false);
    form.setValue("unit", mode === "measured" ? (selectedUnit === "piece" ? "kg" : selectedUnit) : "piece");
    form.setValue("allowDecimalQuantity", mode === "measured");
  }

  function toggleColor(id: string) {
    const next = colorIds.includes(id) ? colorIds.filter((c) => c !== id) : [...colorIds, id];
    form.setValue("colorIds", next);
  }

  function toggleSize(id: string) {
    const next = sizeIds.includes(id) ? sizeIds.filter((x) => x !== id) : [...sizeIds, id];
    form.setValue("sizeIds", next);
  }

  const fabricationPrice = useWatch({ control: form.control, name: "fabricationPrice" });
  const sellingPrice = useWatch({ control: form.control, name: "sellingPrice" });
  const margin =
    sellingPrice > 0 ? ((sellingPrice - fabricationPrice) / sellingPrice) * 100 : 0;

  // Attribute definitions for the currently-selected category.
  const categoryAttributes = categories.find((c) => c.id === categoryId)?.attributes ?? [];
  const showSpecs = attributesEnabled && categoryAttributes.length > 0;
  const quantityStep = unitsEnabled && allowDecimalQuantity ? "0.001" : "1";
  const unitLabel = tUnit(selectedUnit);

  function onSubmit(values: ProductInput) {
    // Merge attribute values for the selected category into the payload.
    const attributes = categoryAttributes.map((d) => ({
      definitionId: d.id,
      value: attrValues[d.id] ?? "",
    }));
    const payload: ProductInput = { ...values, attributes };
    startTransition(async () => {
      // Server actions can throw as well as return { error } — an authorization
      // failure or a DB constraint rejects the promise, and without this catch
      // the rejection escapes the transition to the app error boundary and the
      // user loses everything they typed.
      try {
        const result = productId
          ? await updateProduct(productId, payload)
          : await createProduct(payload);

        if (result?.error) {
          toast.error(result.error);
          return;
        }
        toast.success(productId ? t("toastUpdated") : t("toastCreated"));
        router.push("/products");
        router.refresh();
      } catch {
        toast.error(t("toastSaveFailed"));
      }
    });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
      {!productId && (
        <Card className="border-primary/20 bg-primary/3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("setup.title")}</CardTitle>
            <CardDescription>
              {t("setup.description")}
            </CardDescription>
          </CardHeader>
          {/* These tiles used to be plain <div>s that described the modes but
              set nothing, while the real control was the variants switch far
              below. Users read them as a choice and got no result. */}
          <CardContent className="grid gap-3 md:grid-cols-3">
            <SetupTile
              icon={<Package className="mt-0.5 size-5 shrink-0" />}
              title={t("setup.simpleTitle")}
              description={t("setup.simpleDescription")}
              selected={setupMode === "simple"}
              onSelect={() => chooseSetup("simple")}
            />
            {unitsEnabled && (
              <SetupTile
                icon={<Scale className="mt-0.5 size-5 shrink-0" />}
                title={t("setup.measuredTitle")}
                description={t("setup.measuredDescription")}
                selected={setupMode === "measured"}
                onSelect={() => chooseSetup("measured")}
              />
            )}
            <SetupTile
              icon={<Boxes className="mt-0.5 size-5 shrink-0" />}
              title={t("setup.variantsTitle")}
              description={t("setup.variantsDescription")}
              selected={setupMode === "variants"}
              onSelect={() => chooseSetup("variants")}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>{t("identity.title")}</CardTitle>
          <CardDescription>{t("identity.description")}</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <FieldGroup>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={!!form.formState.errors.name}>
                <FieldLabel htmlFor="name">{t("identity.nameLabel")}</FieldLabel>
                <Input id="name" placeholder={t("identity.namePlaceholder")} autoFocus {...form.register("name")} />
                {form.formState.errors.name && <FieldError>{form.formState.errors.name.message}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor="categoryId">{t("identity.categoryLabel")}</FieldLabel>
                <Controller
                  control={form.control}
                  name="categoryId"
                  render={({ field }) => (
                    <Select
                      value={field.value || NO_CATEGORY}
                      onValueChange={(value) => field.onChange(value === NO_CATEGORY ? "" : value)}
                    >
                      <SelectTrigger id="categoryId" className="w-full">
                        <SelectValue placeholder={t("identity.noCategory")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_CATEGORY}>{t("identity.noCategory")}</SelectItem>
                        {categories.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {categories.length === 0 && (
                  <p className="text-xs text-muted-foreground">{t("identity.noCategoryHint")}</p>
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={!!form.formState.errors.sku}>
                <FieldLabel htmlFor="sku">{t("identity.skuLabel")}</FieldLabel>
                <Input id="sku" placeholder={t("identity.skuPlaceholder")} {...form.register("sku")} />
                {form.formState.errors.sku && <FieldError>{form.formState.errors.sku.message}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor="barcode">{t("identity.barcodeLabel")} <span className="font-normal text-muted-foreground">{t("identity.optional")}</span></FieldLabel>
                <Input id="barcode" inputMode="numeric" placeholder={t("identity.barcodePlaceholder")} {...form.register("barcode")} />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="description">{t("identity.descriptionLabel")} <span className="font-normal text-muted-foreground">{t("identity.optional")}</span></FieldLabel>
              <Textarea id="description" rows={3} placeholder={t("identity.descriptionPlaceholder")} {...form.register("description")} />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>{t("selling.title")}</CardTitle>
          <CardDescription>{t("selling.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <Controller
            control={form.control}
            name="hasVariants"
            render={({ field }) => (
              <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                <div>
                  <p className="text-sm font-medium">{t("selling.hasVariantsLabel")}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("selling.hasVariantsHint")}
                  </p>
                  {field.value && (
                    <p className="mt-2 text-xs font-medium text-primary">
                      {productId
                        ? t("selling.saveThenManageVariants")
                        : t("selling.createBaseFirst")}
                    </p>
                  )}
                </div>
                <Switch
                  aria-label={t("selling.hasVariantsAriaLabel")}
                  checked={!!field.value}
                  onCheckedChange={(on) => {
                    field.onChange(on);
                    // Keep this switch and the tiles above telling the same
                    // story — turning variants off drops the picked options.
                    if (!on) {
                      form.setValue("colorIds", []);
                      form.setValue("sizeIds", []);
                      setColorsOn(false);
                      setSizesOn(false);
                    }
                  }}
                />
              </div>
            )}
          />

          {unitsEnabled && (
            <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="unit">{t("selling.unitLabel")}</FieldLabel>
                <Controller
                  control={form.control}
                  name="unit"
                  render={({ field }) => (
                    <Select value={field.value ?? "piece"} onValueChange={field.onChange}>
                      <SelectTrigger id="unit" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRODUCT_UNITS.map((unit) => (
                          <SelectItem key={unit} value={unit}>
                            {tUnit(unit)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="text-xs text-muted-foreground">{t("selling.unitHint")}</p>
              </Field>
              <Controller
                control={form.control}
                name="allowDecimalQuantity"
                render={({ field }) => (
                  <div className="flex items-center justify-between gap-4 self-start rounded-lg bg-muted/50 px-4 py-3 sm:self-end">
                    <div>
                      <p className="text-sm font-medium">{t("selling.partialQuantitiesLabel")}</p>
                      <p className="text-xs text-muted-foreground">{t("selling.partialQuantitiesHint")}</p>
                    </div>
                    <Switch aria-label={t("selling.partialQuantitiesAriaLabel")} checked={!!field.value} onCheckedChange={field.onChange} />
                  </div>
                )}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sizes come from the store's /sizes vocabulary, and work exactly like
          colors below: stored on the variant, so they only appear for a
          variant product being created. */}
      {!productId && hasVariants && (
        <Card>
          <CardHeader className="border-b pb-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>{t("sizes.title")}</CardTitle>
                <CardDescription>
                  {t("sizes.description")}
                </CardDescription>
              </div>
              <Switch
                aria-label={t("sizes.ariaLabel")}
                checked={sizesOn}
                onCheckedChange={(on) => {
                  setSizesOn(on);
                  if (!on) form.setValue("sizeIds", []);
                }}
              />
            </div>
          </CardHeader>
          {sizesOn && (
            <CardContent className="pt-4">
              {sizes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("sizes.emptyPrefix")}{" "}
                  <Link href="/sizes" className="font-medium text-primary underline-offset-4 hover:underline">
                    {t("sizes.emptyLink")}
                  </Link>{" "}
                  {t("sizes.emptySuffix")}
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    {sizes.map((size) => {
                      const selected = sizeIds.includes(size.id);
                      return (
                        <button
                          key={size.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggleSize(size.id)}
                          className={cn(
                            "inline-flex h-9 min-w-11 items-center justify-center gap-1.5 rounded-md border px-3 text-sm transition-colors",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            selected
                              ? "border-primary bg-primary/5 font-medium text-primary"
                              : "border-border hover:border-primary/50"
                          )}
                        >
                          {selected && <Check className="size-3.5" />}
                          {size.name}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {sizeIds.length === 0
                      ? t("sizes.pickHint")
                      : t("sizes.selectedCount", { count: sizeIds.length })}{" "}
                    <Link href="/sizes" className="text-primary underline-offset-4 hover:underline">
                      {t("sizes.manageLink")}
                    </Link>
                  </p>
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {/* Colors come from the store's /colors vocabulary. They only appear for
          a variant product being created: a color is stored on the variant, so
          on a simple product it has nowhere to go, and on an existing product
          the variant section below is already the place to manage them. */}
      {!productId && hasVariants && (
        <Card>
          <CardHeader className="border-b pb-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>{t("colors.title")}</CardTitle>
                <CardDescription>
                  {t("colors.description")}
                </CardDescription>
              </div>
              <Switch
                aria-label={t("colors.ariaLabel")}
                checked={colorsOn}
                onCheckedChange={(on) => {
                  setColorsOn(on);
                  if (!on) form.setValue("colorIds", []);
                }}
              />
            </div>
          </CardHeader>
          {colorsOn && (
            <CardContent className="pt-4">
              {colors.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("colors.emptyPrefix")}{" "}
                  <Link href="/colors" className="font-medium text-primary underline-offset-4 hover:underline">
                    {t("colors.emptyLink")}
                  </Link>{" "}
                  {t("colors.emptySuffix")}
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    {colors.map((color) => {
                      const rank = colorIds.indexOf(color.id);
                      const selected = rank >= 0;
                      return (
                        <button
                          key={color.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggleColor(color.id)}
                          className={cn(
                            "flex items-center gap-2 rounded-full border py-1.5 pr-3 pl-1.5 text-sm transition-colors",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                          )}
                        >
                          <span
                            className="size-5 shrink-0 rounded-full border"
                            style={{ backgroundColor: color.hex ?? "transparent" }}
                          />
                          {color.name}
                          {/* The order of picking is what makes one color primary
                              and the next secondary — nothing else records it. */}
                          {rank === 0 && <span className="text-xs font-medium text-primary">{t("colors.primary")}</span>}
                          {rank === 1 && <span className="text-xs font-medium text-muted-foreground">{t("colors.secondary")}</span>}
                          {selected && <Check className="size-3.5 text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {colorIds.length === 0
                      ? t("colors.pickHint")
                      : t("colors.selectedCount", { count: colorIds.length })}{" "}
                    <Link href="/colors" className="text-primary underline-offset-4 hover:underline">
                      {t("colors.manageLink")}
                    </Link>
                  </p>
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {/* One line for the real outcome: the server multiplies the two axes, so
          3 colors x 4 sizes is 12 rows, not 7. */}
      {!productId && hasVariants && (sizeIds.length > 0 || colorIds.length > 0) && (
        <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          {t.rich("variantCountNote", {
            count: variantCount,
            combo:
              sizeIds.length > 0 && colorIds.length > 0
                ? t("variantCountCombo", { sizeCount: sizeIds.length, colorCount: colorIds.length })
                : "",
            strong: (chunks) => <span className="font-medium">{chunks}</span>,
          })}
        </p>
      )}

      {showSpecs && (
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle>{t("specs.title")}</CardTitle>
            <CardDescription>{t("specs.description", { categoryName: categories.find((category) => category.id === categoryId)?.name ?? "" })}</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {categoryAttributes.map((attribute) => {
                const value = attrValues[attribute.id] ?? "";
                const fieldId = `attr-${attribute.id}`;
                return (
                  <Field key={attribute.id}>
                    <FieldLabel htmlFor={fieldId}>
                      {attribute.label}
                      {attribute.required && <span className="text-destructive"> *</span>}
                    </FieldLabel>
                    {attribute.type === "BOOLEAN" ? (
                      <div className="flex h-9 items-center">
                        <Switch
                          id={fieldId}
                          checked={value === "true"}
                          onCheckedChange={(checked) => setAttr(attribute.id, checked ? "true" : "false")}
                        />
                      </div>
                    ) : attribute.type === "SELECT" ? (
                      <Select value={value || undefined} onValueChange={(nextValue) => setAttr(attribute.id, nextValue)}>
                        <SelectTrigger className="w-full" id={fieldId}>
                          <SelectValue placeholder={t("specs.selectPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {attribute.options.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={fieldId}
                        type={attribute.type === "NUMBER" ? "number" : "text"}
                        value={value}
                        onChange={(event) => setAttr(attribute.id, event.target.value)}
                      />
                    )}
                  </Field>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>{t("pricing.title")}</CardTitle>
          <CardDescription>
            {hasVariants
              ? t("pricing.descriptionVariants")
              : t("pricing.descriptionSimple", {
                  unitSuffix: unitsEnabled ? t("pricing.descriptionUnitSuffix", { unit: unitLabel.toLowerCase() }) : "",
                })}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <FieldGroup>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={!!form.formState.errors.fabricationPrice}>
                <FieldLabel htmlFor="fabricationPrice">{t("pricing.costPriceLabel")}</FieldLabel>
                <Input
                  id="fabricationPrice"
                  type="number"
                  min="0"
                  step="0.01"
                  {...form.register("fabricationPrice", { valueAsNumber: true })}
                />
                {form.formState.errors.fabricationPrice && (
                  <FieldError>{form.formState.errors.fabricationPrice.message}</FieldError>
                )}
              </Field>
              <Field data-invalid={!!form.formState.errors.sellingPrice}>
                <FieldLabel htmlFor="sellingPrice">{t("pricing.sellingPriceLabel")}</FieldLabel>
                <Input
                  id="sellingPrice"
                  type="number"
                  min="0.01"
                  step="0.01"
                  {...form.register("sellingPrice", { valueAsNumber: true })}
                />
                {form.formState.errors.sellingPrice && (
                  <FieldError>{form.formState.errors.sellingPrice.message}</FieldError>
                )}
              </Field>
            </div>

            {/* A cost above the selling price is a loss — showing it in the
                success colour read as if it were fine. */}
            <div
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                margin < 0 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"
              }`}
            >
              {t("pricing.marginLabel")} <span className="font-semibold">{formatPercent(margin)}</span>
              {margin < 0 && <span>{t("pricing.marginNegativeWarning")}</span>}
            </div>

            <div className={`grid grid-cols-1 gap-4 ${hasVariants ? "sm:grid-cols-1" : "sm:grid-cols-3"}`}>
              {!hasVariants && (
                <>
                  <Field data-invalid={!!form.formState.errors.stock}>
                    <FieldLabel htmlFor="stock">{t("pricing.openingStockLabel", { unitSuffix: unitsEnabled ? ` (${selectedUnit})` : "" })}</FieldLabel>
                    <Input
                      id="stock"
                      type="number"
                      min="0"
                      step={quantityStep}
                      {...form.register("stock", { valueAsNumber: true })}
                    />
                    {form.formState.errors.stock && <FieldError>{form.formState.errors.stock.message}</FieldError>}
                  </Field>
                  <Field data-invalid={!!form.formState.errors.minimumStock}>
                    <FieldLabel htmlFor="minimumStock">{t("pricing.lowStockAlertLabel", { unitSuffix: unitsEnabled ? ` (${selectedUnit})` : "" })}</FieldLabel>
                    <Input
                      id="minimumStock"
                      type="number"
                      min="0"
                      step={quantityStep}
                      {...form.register("minimumStock", { valueAsNumber: true })}
                    />
                    {form.formState.errors.minimumStock && (
                      <FieldError>{form.formState.errors.minimumStock.message}</FieldError>
                    )}
                  </Field>
                </>
              )}
              <Field>
                <FieldLabel htmlFor="status">{t("pricing.statusLabel")}</FieldLabel>
                <Controller
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="status" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ACTIVE">{t("pricing.statusActive")}</SelectItem>
                        <SelectItem value="DRAFT">{t("pricing.statusDraft")}</SelectItem>
                        <SelectItem value="ARCHIVED">{t("pricing.statusArchived")}</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      {!hasVariants && (
        <details className="group rounded-xl border bg-card text-card-foreground shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
            <div>
              <p className="font-semibold leading-none">{t("legacy.title")}</p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {t("legacy.description")}
              </p>
            </div>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid grid-cols-1 gap-4 border-t p-5 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="type">{t("legacy.typeLabel")}</FieldLabel>
              <Input id="type" placeholder={t("legacy.typePlaceholder")} {...form.register("type")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="size">{t("legacy.sizeLabel")}</FieldLabel>
              <Input id="size" placeholder={t("legacy.sizePlaceholder")} {...form.register("size")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="color">{t("legacy.colorLabel")}</FieldLabel>
              <Input id="color" placeholder={t("legacy.colorPlaceholder")} {...form.register("color")} />
            </Field>
          </div>
        </details>
      )}

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>{t("images.title")}</CardTitle>
          <CardDescription>{t("images.description")}</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <Controller
            control={form.control}
            name="images"
            render={({ field }) => <ImageUploader value={field.value} onChange={field.onChange} />}
          />
        </CardContent>
      </Card>

      <div className="sticky bottom-4 z-10 flex items-center justify-end gap-2 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur supports-backdrop-filter:bg-background/80">
        <Button type="button" variant="outline" onClick={() => router.push("/products")}>{tCommon("cancel")}</Button>
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="size-4 animate-spin" />}
          {productId ? t("saveChanges") : t("create")}
        </Button>
      </div>
    </form>
  );
}

/** One mode tile in the "choose the simplest setup" card. A real button, so it
 *  is keyboard-reachable and announces its state to a screen reader. */
function SetupTile({
  icon,
  title,
  description,
  selected,
  onSelect,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex gap-3 rounded-lg border bg-background p-3 text-left transition-colors",
        "hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-primary ring-1 ring-primary" : "border-border"
      )}
    >
      <span className={selected ? "text-primary" : "text-muted-foreground"}>{icon}</span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {title}
          {selected && <Check className="size-3.5 text-primary" />}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}
