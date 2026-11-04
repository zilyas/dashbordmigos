"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Plus, Store as StoreIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { buildStoreColumns } from "@/components/stores/store-columns";
import { StoreDialog } from "@/components/stores/store-dialog";
import { deleteStore, toggleStoreStatus } from "@/actions/stores";
import type { StoreListItem } from "@/lib/queries/stores";

export function StoresTable({ stores }: { stores: StoreListItem[] }) {
  const router = useRouter();
  const t = useTranslations("people.stores");
  const tTable = useTranslations("people.stores.table");
  const tColumns = useTranslations("people.stores.columns");
  const tLabels = useTranslations("labels");
  const tCommon = useTranslations("common");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<StoreListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoreListItem | null>(null);

  async function handleToggleStatus(store: StoreListItem) {
    const result = await toggleStoreStatus(store.id);
    if (result?.error) {
      toast.error(result.error);
    } else {
      toast.success(result?.status === "ACTIVE" ? t("toastActivated") : t("toastDeactivated"));
    }
  }

  const columns = useMemo(
    () =>
      buildStoreColumns({
        onEdit: setEditing,
        onToggleStatus: handleToggleStatus,
        onDelete: setDeleteTarget,
        tLabels,
        t: tColumns,
      }),
    [tLabels, tColumns]
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={stores}
        searchPlaceholder={tTable("searchPlaceholder")}
        emptyIcon={<StoreIcon />}
        emptyTitle={tTable("emptyTitle")}
        emptyDescription={tTable("emptyDescription")}
        onRowClick={(store) => router.push(`/stores/${store.id}`)}
        toolbar={
          <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {tTable("newStore")}
          </Button>
        }
      />

      <StoreDialog open={createOpen} onOpenChange={setCreateOpen} store={null} />
      {editing && (
        <StoreDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} store={editing} />
      )}
      {deleteTarget && (
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title={t("deleteDialog.title", { name: deleteTarget.name })}
          description={t("deleteDialog.description")}
          confirmLabel={tCommon("delete")}
          destructive
          onConfirm={async () => {
            const result = await deleteStore(deleteTarget.id);
            if (result?.error) {
              toast.error(result.error);
            } else if (result?.deactivated) {
              toast.success(t("deleteDialog.toastDeactivated"));
            } else {
              toast.success(t("deleteDialog.toastDeleted"));
            }
          }}
        />
      )}
    </>
  );
}
