import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { ProductForm } from "@/components/products/product-form";
import { getCategories } from "@/lib/queries/categories";
import { getColors } from "@/lib/queries/colors";
import { getSizes } from "@/lib/queries/sizes";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { getStoreFeatures } from "@/lib/features";
import { getTranslations } from "next-intl/server";
import { toAppLocale } from "@/i18n/messages";

export const metadata: Metadata = { title: "New Product" };

export default async function NewProductPage() {
  const context = await getSessionContext();
  const t = await getTranslations({ locale: toAppLocale(context!.locale), namespace: "products.newPage" });
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
        title={t("title")}
        description={t("description")}
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
