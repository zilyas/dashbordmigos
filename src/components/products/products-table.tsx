"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Package, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { buildProductColumns } from "@/components/products/product-columns";
import { bulkUpdateProductStatus, deleteProduct } from "@/actions/products";
import type { ProductListItem } from "@/lib/queries/products";
import type { CategoryListItem } from "@/lib/queries/categories";

const ALL = "all";

export function ProductsTable({
  products,
  categories,
  currency,
  canEdit,
  canViewCost,
}: {
  products: ProductListItem[];
  categories: CategoryListItem[];
  currency: string;
  canEdit: boolean;
  canViewCost: boolean;
}) {
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [deleteTarget, setDeleteTarget] = useState<ProductListItem | null>(null);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (categoryFilter !== ALL && p.categoryId !== categoryFilter) return false;
      if (statusFilter !== ALL && p.status !== statusFilter) return false;
      return true;
    });
  }, [products, categoryFilter, statusFilter]);

  async function handleArchiveToggle(product: ProductListItem) {
    const nextStatus = product.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED";
    const result = await bulkUpdateProductStatus([product.id], nextStatus);
    if (result?.error) {
      toast.error(result.error);
    } else {
      toast.success(nextStatus === "ARCHIVED" ? "Product archived" : "Product activated");
    }
  }

  const columns = useMemo(
    () =>
      buildProductColumns({
        currency,
        canEdit,
        canViewCost,
        onArchiveToggle: handleArchiveToggle,
        onDelete: setDeleteTarget,
      }),
    [currency, canEdit, canViewCost]
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={filtered}
        searchPlaceholder="Search products..."
        enableRowSelection={canEdit}
        emptyIcon={<Package />}
        emptyTitle="No products found"
        emptyDescription="Try adjusting your filters, or add a new product."
        toolbar={
          <>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="ARCHIVED">Archived</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        bulkActions={
          canEdit
            ? (selected, clearSelection) => (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5"
                    onClick={async () => {
                      await bulkUpdateProductStatus(
                        selected.map((p) => p.id),
                        "ACTIVE"
                      );
                      toast.success(`${selected.length} product(s) activated`);
                      clearSelection();
                    }}
                  >
                    <ArchiveRestore className="size-3.5" />
                    Activate
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5"
                    onClick={async () => {
                      await bulkUpdateProductStatus(
                        selected.map((p) => p.id),
                        "ARCHIVED"
                      );
                      toast.success(`${selected.length} product(s) archived`);
                      clearSelection();
                    }}
                  >
                    <Archive className="size-3.5" />
                    Archive
                  </Button>
                </>
              )
            : undefined
        }
      />

      {deleteTarget && (
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title={`Delete "${deleteTarget.name}"?`}
          description="If this product has sale or inventory history, it will be archived instead of deleted to preserve your records."
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            const result = await deleteProduct(deleteTarget.id);
            if (result?.error) {
              toast.error(result.error);
            } else if (result?.archived) {
              toast.success("Product archived (has related history)");
            } else {
              toast.success("Product deleted");
            }
          }}
        />
      )}
    </>
  );
}
