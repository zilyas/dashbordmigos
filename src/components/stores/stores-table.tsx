"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<StoreListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoreListItem | null>(null);

  async function handleToggleStatus(store: StoreListItem) {
    const result = await toggleStoreStatus(store.id);
    if (result?.error) {
      toast.error(result.error);
    } else {
      toast.success(result?.status === "ACTIVE" ? "Store activated" : "Store deactivated");
    }
  }

  const columns = useMemo(
    () =>
      buildStoreColumns({
        onEdit: setEditing,
        onToggleStatus: handleToggleStatus,
        onDelete: setDeleteTarget,
      }),
    []
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={stores}
        searchPlaceholder="Search stores..."
        emptyIcon={<StoreIcon />}
        emptyTitle="No stores yet"
        emptyDescription="Create your first store to get started."
        onRowClick={(store) => router.push(`/stores/${store.id}`)}
        toolbar={
          <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New Store
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
          title={`Delete "${deleteTarget.name}"?`}
          description="If this store has real data (products, sales, staff), it will be deactivated instead of deleted to preserve records."
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            const result = await deleteStore(deleteTarget.id);
            if (result?.error) {
              toast.error(result.error);
            } else if (result?.deactivated) {
              toast.success("Store deactivated (has related data)");
            } else {
              toast.success("Store deleted");
            }
          }}
        />
      )}
    </>
  );
}
