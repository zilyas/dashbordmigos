import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { can } from "@/lib/rbac";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { ProductsTable } from "@/components/products/products-table";
import { getProducts } from "@/lib/queries/products";
import { getCategories } from "@/lib/queries/categories";
import { getStoreSettings } from "@/lib/queries/settings";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage() {
  const context = await getSessionContext();
  const storeId = requireStoreId(context!);
  const role = context!.role;

  const [products, categories, settings] = await Promise.all([
    getProducts(storeId),
    getCategories(storeId),
    getStoreSettings(storeId),
  ]);

  const canEdit = can(role, "product.edit");
  const canViewCost = role === "MANAGER" || (role === "SELLER" && settings.allowSellerViewCost);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Products"
        description={`${products.length} product${products.length === 1 ? "" : "s"} in your catalog`}
        actions={
          canEdit ? (
            <Button asChild className="gap-1.5">
              <Link href="/products/new">
                <Plus className="size-4" />
                New Product
              </Link>
            </Button>
          ) : undefined
        }
      />
      <ProductsTable
        products={products}
        categories={categories}
        currency={settings.currency}
        canEdit={canEdit}
        canViewCost={canViewCost}
        unitsEnabled={settings.features.units_enabled}
      />
    </div>
  );
}
