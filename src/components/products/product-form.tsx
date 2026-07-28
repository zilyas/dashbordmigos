"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
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
import { ImageUploader } from "@/components/products/image-uploader";
import { createProduct, updateProduct } from "@/actions/products";
import { productSchema, type ProductInput } from "@/lib/validations/product";
import { formatPercent } from "@/lib/format";
import type { CategoryListItem } from "@/lib/queries/categories";

const NO_CATEGORY = "none";

export function ProductForm({
  categories,
  productId,
  defaultValues,
}: {
  categories: CategoryListItem[];
  productId?: string;
  defaultValues?: Partial<ProductInput>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

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
      ...defaultValues,
    },
  });

  const fabricationPrice = form.watch("fabricationPrice");
  const sellingPrice = form.watch("sellingPrice");
  const margin =
    sellingPrice > 0 ? ((sellingPrice - fabricationPrice) / sellingPrice) * 100 : 0;

  function onSubmit(values: ProductInput) {
    startTransition(async () => {
      const result = productId
        ? await updateProduct(productId, values)
        : await createProduct(values);

      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(productId ? "Product updated" : "Product created");
      router.push("/products");
      router.refresh();
    });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>Basic information</CardTitle>
          <CardDescription>Name, identifiers and category.</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <FieldGroup>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={!!form.formState.errors.name}>
                <FieldLabel htmlFor="name">Product name</FieldLabel>
                <Input id="name" {...form.register("name")} />
                {form.formState.errors.name && <FieldError>{form.formState.errors.name.message}</FieldError>}
              </Field>
              <Field data-invalid={!!form.formState.errors.sku}>
                <FieldLabel htmlFor="sku">SKU</FieldLabel>
                <Input id="sku" {...form.register("sku")} />
                {form.formState.errors.sku && <FieldError>{form.formState.errors.sku.message}</FieldError>}
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="barcode">Barcode</FieldLabel>
                <Input id="barcode" {...form.register("barcode")} />
              </Field>
              <Field>
                <FieldLabel>Category</FieldLabel>
                <Controller
                  control={form.control}
                  name="categoryId"
                  render={({ field }) => (
                    <Select
                      value={field.value || NO_CATEGORY}
                      onValueChange={(v) => field.onChange(v === NO_CATEGORY ? "" : v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="No category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_CATEGORY}>No category</SelectItem>
                        {categories.map((c) => (
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="type">Type</FieldLabel>
                <Input id="type" placeholder="e.g. Hoodie" {...form.register("type")} />
              </Field>
              <Field>
                <FieldLabel htmlFor="size">Size</FieldLabel>
                <Input id="size" placeholder="e.g. M" {...form.register("size")} />
              </Field>
              <Field>
                <FieldLabel htmlFor="color">Color</FieldLabel>
                <Input id="color" placeholder="e.g. Black" {...form.register("color")} />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="description">Description</FieldLabel>
              <Textarea id="description" rows={3} {...form.register("description")} />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>Pricing & stock</CardTitle>
          <CardDescription>Fabrication cost, selling price and inventory levels.</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <FieldGroup>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={!!form.formState.errors.fabricationPrice}>
                <FieldLabel htmlFor="fabricationPrice">Fabrication price</FieldLabel>
                <Input
                  id="fabricationPrice"
                  type="number"
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
                  step="0.01"
                  {...form.register("sellingPrice", { valueAsNumber: true })}
                />
                {form.formState.errors.sellingPrice && (
                  <FieldError>{form.formState.errors.sellingPrice.message}</FieldError>
                )}
              </Field>
            </div>

            <div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
              Profit margin: <span className="font-semibold">{formatPercent(margin)}</span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field data-invalid={!!form.formState.errors.stock}>
                <FieldLabel htmlFor="stock">Stock quantity</FieldLabel>
                <Input id="stock" type="number" {...form.register("stock", { valueAsNumber: true })} />
                {form.formState.errors.stock && <FieldError>{form.formState.errors.stock.message}</FieldError>}
              </Field>
              <Field data-invalid={!!form.formState.errors.minimumStock}>
                <FieldLabel htmlFor="minimumStock">Minimum stock</FieldLabel>
                <Input
                  id="minimumStock"
                  type="number"
                  {...form.register("minimumStock", { valueAsNumber: true })}
                />
              </Field>
              <Field>
                <FieldLabel>Status</FieldLabel>
                <Controller
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ACTIVE">Active</SelectItem>
                        <SelectItem value="DRAFT">Draft</SelectItem>
                        <SelectItem value="ARCHIVED">Archived</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>Images</CardTitle>
          <CardDescription>Up to 6 images. First image is used as the cover.</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <Controller
            control={form.control}
            name="images"
            render={({ field }) => <ImageUploader value={field.value} onChange={field.onChange} />}
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.push("/products")}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="size-4 animate-spin" />}
          {productId ? "Save changes" : "Create product"}
        </Button>
      </div>
    </form>
  );
}
