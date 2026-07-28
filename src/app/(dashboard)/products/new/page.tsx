import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { ProductForm } from "@/components/products/product-form";
import { getCategories } from "@/lib/queries/categories";
import { getSessionContext, requireStoreId } from "@/lib/store-context";

export const metadata: Metadata = { title: "New Product" };

export default async function NewProductPage() {
  const context = await getSessionContext();
  const storeId = requireStoreId(context!);
  const categories = await getCategories(storeId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="New product" description="Add a new product to your catalog." />
      <ProductForm categories={categories} />
    </div>
  );
}
