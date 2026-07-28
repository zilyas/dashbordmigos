import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { CategoriesManager } from "@/components/categories/categories-manager";
import { getCategories } from "@/lib/queries/categories";
import { getSessionContext, requireStoreId } from "@/lib/store-context";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const context = await getSessionContext();
  const storeId = requireStoreId(context!);
  const categories = await getCategories(storeId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Categories" description="Organize your products into categories." />
      <CategoriesManager categories={categories} />
    </div>
  );
}
