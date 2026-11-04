"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Package, Archive, ArchiveRestore } from "lucide-react";
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
import { PRODUCT_UNITS } from "@/lib/validations/product";
import type { ProductListItem } from "@/lib/queries/products";
import type { CategoryListItem } from "@/lib/queries/categories";

const ALL = "all";

export function ProductsTable({
  products,
  categories,
  currency,
  canEdit,
  canViewCost,
  unitsEnabled = false,
}: {
  products: ProductListItem[];
  categories: CategoryListItem[];
  currency: string;
  canEdit: boolean;
  canViewCost: boolean;
  /** Store has units_enabled — show the unit filter. */
  unitsEnabled?: boolean;
}) {
  const tLabels = useTranslations("labels");
  const t = useTranslations("products.table");
  const tUnit = useTranslations("products.unit");
  const tCommon = useTranslations("common");
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [unitFilter, setUnitFilter] = useState(ALL);
  const [variantsFilter, setVariantsFilter] = useState(ALL);
  const [deleteTarget, setDeleteTarget] = useState<ProductListItem | null>(null);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (categoryFilter !== ALL && p.categoryId !== categoryFilter) return false;
      if (statusFilter !== ALL && p.status !== statusFilter) return false;
      if (unitsEnabled && unitFilter !== ALL && p.unit !== unitFilter) return false;
      if (variantsFilter === "yes" && !p.hasVariants) return false;
      if (variantsFilter === "no" && p.hasVariants) return false;
      return true;
    });
  }, [products, categoryFilter, statusFilter, unitFilter, variantsFilter, unitsEnabled]);

  async function handleArchiveToggle(product: ProductListItem) {
    const nextStatus = product.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED";
    const result = await bulkUpdateProductStatus([product.id], nextStatus);
    if (result?.error) {
      toast.error(result.error);
    } else {
      toast.success(nextStatus === "ARCHIVED" ? t("toastArchived") : t("toastActivated"));
    }
  }

  const tColumns = useTranslations("products.columns");
  const columns = useMemo(
    () =>
      buildProductColumns({
        currency,
        canEdit,
        canViewCost,
        onArchiveToggle: handleArchiveToggle,
        onDelete: setDeleteTarget,
        tLabels,
        t: tColumns,
      }),
    [currency, canEdit, canViewCost, tLabels, tColumns]
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={filtered}
        searchPlaceholder={t("searchPlaceholder")}
        enableRowSelection={canEdit}
        emptyIcon={<Package />}
        emptyTitle={t("emptyTitle")}
        emptyDescription={t("emptyDescription")}
        toolbar={
          <>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t("filters.categoryPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("filters.allCategories")}</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder={t("filters.statusPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("filters.allStatuses")}</SelectItem>
                <SelectItem value="ACTIVE">{tLabels("productStatus.ACTIVE")}</SelectItem>
                <SelectItem value="DRAFT">{tLabels("productStatus.DRAFT")}</SelectItem>
                <SelectItem value="ARCHIVED">{tLabels("productStatus.ARCHIVED")}</SelectItem>
              </SelectContent>
            </Select>
            {unitsEnabled && (
              <Select value={unitFilter} onValueChange={setUnitFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder={t("filters.unitPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t("filters.allUnits")}</SelectItem>
                  {PRODUCT_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {tUnit(u)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={variantsFilter} onValueChange={setVariantsFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder={t("filters.variantsPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("filters.allProducts")}</SelectItem>
                <SelectItem value="yes">{t("filters.hasVariants")}</SelectItem>
                <SelectItem value="no">{t("filters.noVariants")}</SelectItem>
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
                      toast.success(t("toastBulkActivated", { count: selected.length }));
                      clearSelection();
                    }}
                  >
                    <ArchiveRestore className="size-3.5" />
                    {t("bulkActivate")}
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
                      toast.success(t("toastBulkArchived", { count: selected.length }));
                      clearSelection();
                    }}
                  >
                    <Archive className="size-3.5" />
                    {t("bulkArchive")}
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
          title={t("deleteTitle", { name: deleteTarget.name })}
          description={t("deleteDescription")}
          confirmLabel={tCommon("delete")}
          destructive
          onConfirm={async () => {
            const result = await deleteProduct(deleteTarget.id);
            if (result?.error) {
              toast.error(result.error);
            } else if (result?.archived) {
              toast.success(t("toastArchivedInstead"));
            } else {
              toast.success(t("toastDeleted"));
            }
          }}
        />
      )}
    </>
  );
}
