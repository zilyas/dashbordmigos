import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { ProductForm } from "@/components/products/product-form";
import { getCategories } from "@/lib/queries/categories";
import { getColors } from "@/lib/queries/colors";
import { getSizes } from "@/lib/queries/sizes";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { getStoreFeatures } from "@/lib/features";

export const metadata: Metadata = { title: "New Product" };

export default async function NewProductPage() {
  const context = await getSessionContext();
  const storeId = requireStoreId(context!);
  const [categories, colors, sizes, features] = await Promise.all([
    getCategories(storeId),
    getColors(storeId),
    getSizes(storeId),
    getStoreFeatures(storeId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New product"
        description="Create a simple item, a measured product, or a product with variants."
      />
      <ProductForm
        categories={categories}
        colors={colors}
        sizes={sizes}
        unitsEnabled={features.units_enabled}
        attributesEnabled={features.category_attributes_enabled}
      />
    </div>
  );
}
