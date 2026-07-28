import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { ProductForm } from "@/components/products/product-form";
import { getCategories } from "@/lib/queries/categories";
import { getProductById } from "@/lib/queries/products";
import { getSessionContext, requireStoreId } from "@/lib/store-context";

export const metadata: Metadata = { title: "Edit Product" };

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await getSessionContext();
  const storeId = requireStoreId(context!);

  const [product, categories] = await Promise.all([
    getProductById(id, storeId),
    getCategories(storeId),
  ]);

  if (!product) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Edit product" description={product.name} />
      <ProductForm categories={categories} productId={product.id} defaultValues={product} />
    </div>
  );
}
