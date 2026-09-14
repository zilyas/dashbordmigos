import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { ProductForm } from "@/components/products/product-form";
import { VariantManager } from "@/components/products/variant-manager";
import { BatchManager } from "@/components/products/batch-manager";
import { getCategories } from "@/lib/queries/categories";
import { getProductById, getProductVariants } from "@/lib/queries/products";
import { getProductBatchView } from "@/lib/queries/batches";
import { getSizes } from "@/lib/queries/sizes";
import { getColors } from "@/lib/queries/colors";
import { getVariantAxes } from "@/lib/queries/variant-axes";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { getStoreFeatures } from "@/lib/features";

export const metadata: Metadata = { title: "Edit Product" };

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await getSessionContext();
  const storeId = requireStoreId(context!);

  const [product, categories, features] = await Promise.all([
    getProductById(id, storeId),
    getCategories(storeId),
    getStoreFeatures(storeId),
  ]);

  if (!product) notFound();

  // Variant management data is only needed when the product is variant-enabled.
  const [variants, sizes, colors, allAxes] = product.hasVariants
    ? await Promise.all([
        getProductVariants(product.id, storeId),
        getSizes(storeId),
        getColors(storeId),
        features.custom_variant_axes_enabled ? getVariantAxes(storeId) : Promise.resolve([]),
      ])
    : [[], [], [], []];

  const customAxes = allAxes.filter((a) => a.isActive).map((a) => ({ key: a.key, label: a.label }));

  // Batch management is gated by the store feature flag (dormant otherwise).
  const batchView = features.expiry_batch_enabled ? await getProductBatchView(product.id, storeId) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Edit product" description={product.name} />
      <ProductForm
        categories={categories}
        productId={product.id}
        defaultValues={product}
        unitsEnabled={features.units_enabled}
        attributesEnabled={features.category_attributes_enabled}
      />
      {product.hasVariants && (
        <VariantManager
          productId={product.id}
          variants={variants}
          sizes={sizes.map((s) => ({ id: s.id, name: s.name }))}
          colors={colors.map((c) => ({ id: c.id, name: c.name }))}
          allowDecimal={features.units_enabled && product.allowDecimalQuantity}
          axes={customAxes}
        />
      )}
      {batchView && <BatchManager view={batchView} />}
    </div>
  );
}
