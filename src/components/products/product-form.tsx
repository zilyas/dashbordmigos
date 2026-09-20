"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
  productSchema,
  type ProductInput,
  PRODUCT_UNITS,
  PRODUCT_UNIT_LABELS,
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
  const unitLabel = PRODUCT_UNIT_LABELS[selectedUnit];

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
        toast.success(productId ? "Product updated" : "Product created");
        router.push("/products");
        router.refresh();
      } catch {
        toast.error("Could not save the product. Please try again.");
      }
    });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
      {!productId && (
        <Card className="border-primary/20 bg-primary/3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Choose the simplest setup that fits</CardTitle>
            <CardDescription>
              Pick one. It sets the options below for you — you can still change them by hand.
            </CardDescription>
          </CardHeader>
          {/* These tiles used to be plain <div>s that described the modes but
              set nothing, while the real control was the variants switch far
              below. Users read them as a choice and got no result. */}
          <CardContent className="grid gap-3 md:grid-cols-3">
            <SetupTile
              icon={<Package className="mt-0.5 size-5 shrink-0" />}
              title="Simple item"
              description="Charger, shampoo, canned food, or any item sold as one SKU."
              selected={setupMode === "simple"}
              onSelect={() => chooseSetup("simple")}
            />
            {unitsEnabled && (
              <SetupTile
                icon={<Scale className="mt-0.5 size-5 shrink-0" />}
                title="Measured item"
                description="Rice by kilogram, fabric by meter, or oil by liter."
                selected={setupMode === "measured"}
                onSelect={() => chooseSetup("measured")}
              />
            )}
            <SetupTile
              icon={<Boxes className="mt-0.5 size-5 shrink-0" />}
              title="Item with variants"
              description="Clothing sizes, phone storage, cosmetic shades, or flavors."
              selected={setupMode === "variants"}
              onSelect={() => chooseSetup("variants")}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>Product identity</CardTitle>
          <CardDescription>Only the name and SKU are required. Add a category to unlock its specifications.</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <FieldGroup>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={!!form.formState.errors.name}>
                <FieldLabel htmlFor="name">Product name</FieldLabel>
                <Input id="name" placeholder="e.g. Organic rice, T-shirt, Wireless headset" autoFocus {...form.register("name")} />
                {form.formState.errors.name && <FieldError>{form.formState.errors.name.message}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor="categoryId">Category</FieldLabel>
                <Controller
                  control={form.control}
                  name="categoryId"
                  render={({ field }) => (
                    <Select
                      value={field.value || NO_CATEGORY}
                      onValueChange={(value) => field.onChange(value === NO_CATEGORY ? "" : value)}
                    >
                      <SelectTrigger id="categoryId" className="w-full">
                        <SelectValue placeholder="No category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_CATEGORY}>No category</SelectItem>
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
                  <p className="text-xs text-muted-foreground">You can save now and organize the product into a category later.</p>
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={!!form.formState.errors.sku}>
                <FieldLabel htmlFor="sku">SKU</FieldLabel>
                <Input id="sku" placeholder="Your internal stock code" {...form.register("sku")} />
                {form.formState.errors.sku && <FieldError>{form.formState.errors.sku.message}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor="barcode">Barcode <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel>
                <Input id="barcode" inputMode="numeric" placeholder="Scan or enter a barcode" {...form.register("barcode")} />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="description">Description <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel>
              <Textarea id="description" rows={3} placeholder="Useful details for staff and catalog records" {...form.register("description")} />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>How this product is sold</CardTitle>
          <CardDescription>Keep a single SKU, sell by a unit of measure, or manage separate variant SKUs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <Controller
            control={form.control}
            name="hasVariants"
            render={({ field }) => (
              <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                <div>
                  <p className="text-sm font-medium">This product has variants</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Use for options with their own SKU, price, or stock—such as size, color, storage, shade, or flavor.
                  </p>
                  {field.value && (
                    <p className="mt-2 text-xs font-medium text-primary">
                      {productId
                        ? "Save changes, then manage each variant below."
                        : "Create the base product first; you will add individual variants from its edit page."}
                    </p>
                  )}
                </div>
                <Switch
                  aria-label="Product has variants"
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
                <FieldLabel htmlFor="unit">Unit of measure</FieldLabel>
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
                            {PRODUCT_UNIT_LABELS[unit]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="text-xs text-muted-foreground">Choose how stock and sale quantities are counted.</p>
              </Field>
              <Controller
                control={form.control}
                name="allowDecimalQuantity"
                render={({ field }) => (
                  <div className="flex items-center justify-between gap-4 self-start rounded-lg bg-muted/50 px-4 py-3 sm:self-end">
                    <div>
                      <p className="text-sm font-medium">Allow partial quantities</p>
                      <p className="text-xs text-muted-foreground">Enable for values such as 0.5 kg or 1.25 L.</p>
                    </div>
                    <Switch aria-label="Allow partial quantities" checked={!!field.value} onCheckedChange={field.onChange} />
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
                <CardTitle>Sizes</CardTitle>
                <CardDescription>
                  Pick every size you sell. Combined with the colors below, one variant is created per
                  combination.
                </CardDescription>
              </div>
              <Switch
                aria-label="This product comes in sizes"
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
                  No sizes yet.{" "}
                  <Link href="/sizes" className="font-medium text-primary underline-offset-4 hover:underline">
                    Add them in Sizes
                  </Link>{" "}
                  first, then come back.
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
                      ? "Pick one or more, or leave this off if the product has no sizes."
                      : `${sizeIds.length} size${sizeIds.length === 1 ? "" : "s"} selected.`}{" "}
                    <Link href="/sizes" className="text-primary underline-offset-4 hover:underline">
                      Manage sizes
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
                <CardTitle>Colors</CardTitle>
                <CardDescription>
                  Pick every color you sell. Each one becomes a variant with its own SKU and stock.
                </CardDescription>
              </div>
              <Switch
                aria-label="This product comes in colors"
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
                  No colors yet.{" "}
                  <Link href="/colors" className="font-medium text-primary underline-offset-4 hover:underline">
                    Add them in Colors
                  </Link>{" "}
                  first, then come back.
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
                          {rank === 0 && <span className="text-xs font-medium text-primary">Primary</span>}
                          {rank === 1 && <span className="text-xs font-medium text-muted-foreground">Secondary</span>}
                          {selected && <Check className="size-3.5 text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {colorIds.length === 0
                      ? "Pick one or more. The first is the primary color."
                      : `${colorIds.length} color${colorIds.length === 1 ? "" : "s"} selected.`}{" "}
                    <Link href="/colors" className="text-primary underline-offset-4 hover:underline">
                      Manage colors
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
          <span className="font-medium">{variantCount}</span> variant{variantCount === 1 ? "" : "s"} will be
          created with zero stock
          {sizeIds.length > 0 && colorIds.length > 0
            ? ` (${sizeIds.length} size${sizeIds.length === 1 ? "" : "s"} × ${colorIds.length} color${colorIds.length === 1 ? "" : "s"})`
            : ""}
          . Set their stock and prices from the product&apos;s edit page.
        </p>
      )}

      {showSpecs && (
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle>Category specifications</CardTitle>
            <CardDescription>Details configured for {categories.find((category) => category.id === categoryId)?.name}.</CardDescription>
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
                          <SelectValue placeholder="Select…" />
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
          <CardTitle>Pricing and inventory</CardTitle>
          <CardDescription>
            {hasVariants
              ? "Set default prices here. Stock is entered separately for each variant after the product is saved."
              : `Set the prices and available stock${unitsEnabled ? ` in ${unitLabel.toLowerCase()}` : ""}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <FieldGroup>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={!!form.formState.errors.fabricationPrice}>
                <FieldLabel htmlFor="fabricationPrice">Cost price</FieldLabel>
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
                <FieldLabel htmlFor="sellingPrice">Selling price</FieldLabel>
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
              Estimated profit margin: <span className="font-semibold">{formatPercent(margin)}</span>
              {margin < 0 && <span>— the cost price is above the selling price.</span>}
            </div>

            <div className={`grid grid-cols-1 gap-4 ${hasVariants ? "sm:grid-cols-1" : "sm:grid-cols-3"}`}>
              {!hasVariants && (
                <>
                  <Field data-invalid={!!form.formState.errors.stock}>
                    <FieldLabel htmlFor="stock">Opening stock{unitsEnabled ? ` (${selectedUnit})` : ""}</FieldLabel>
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
                    <FieldLabel htmlFor="minimumStock">Low-stock alert{unitsEnabled ? ` (${selectedUnit})` : ""}</FieldLabel>
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
                <FieldLabel htmlFor="status">Status</FieldLabel>
                <Controller
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="status" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ACTIVE">Active — available for sale</SelectItem>
                        <SelectItem value="DRAFT">Draft — still being prepared</SelectItem>
                        <SelectItem value="ARCHIVED">Archived — hidden from sale</SelectItem>
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
              <p className="font-semibold leading-none">Optional legacy details</p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Use only if your catalog already relies on a single product type, size, or color.
              </p>
            </div>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid grid-cols-1 gap-4 border-t p-5 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="type">Type or model</FieldLabel>
              <Input id="type" placeholder="e.g. Hoodie, Pro, Organic" {...form.register("type")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="size">Size or format</FieldLabel>
              <Input id="size" placeholder="e.g. M, 500 ml, 13-inch" {...form.register("size")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="color">Color or finish</FieldLabel>
              <Input id="color" placeholder="e.g. Black, Matte, Natural" {...form.register("color")} />
            </Field>
          </div>
        </details>
      )}

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>Product images</CardTitle>
          <CardDescription>Optional. Add up to 6 images; the first image becomes the cover.</CardDescription>
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
        <Button type="button" variant="outline" onClick={() => router.push("/products")}>Cancel</Button>
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="size-4 animate-spin" />}
          {productId ? "Save changes" : "Create product"}
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
