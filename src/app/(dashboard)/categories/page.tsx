import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { CategoriesManager } from "@/components/categories/categories-manager";
import { getCategories } from "@/lib/queries/categories";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { getStoreFeatures } from "@/lib/features";
import { getTranslations } from "next-intl/server";
import { toAppLocale } from "@/i18n/messages";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const context = await getSessionContext();
  const t = await getTranslations({ locale: toAppLocale(context!.locale), namespace: "catalog.categories.page" });
  const storeId = requireStoreId(context!);
  const [categories, features] = await Promise.all([getCategories(storeId), getStoreFeatures(storeId)]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      <CategoriesManager
        categories={categories}
        attributesEnabled={features.category_attributes_enabled}
      />
    </div>
  );
}
