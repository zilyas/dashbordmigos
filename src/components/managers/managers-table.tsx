"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Users as UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ResetPasswordDialog } from "@/components/shared/reset-password-dialog";
import { buildManagerColumns } from "@/components/managers/manager-columns";
import { CreateManagerDialog, EditManagerDialog } from "@/components/managers/manager-dialog";
import { TransferManagerDialog } from "@/components/managers/transfer-manager-dialog";
import { deleteManager, resetManagerPassword, toggleManagerStatus } from "@/actions/managers";
import type { ManagerListItem } from "@/lib/queries/users";

type StoreOption = { id: string; name: string; code: string };

export function ManagersTable({
  managers,
  stores,
}: {
  managers: ManagerListItem[];
  stores: StoreOption[];
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ManagerListItem | null>(null);
  const [transferring, setTransferring] = useState<ManagerListItem | null>(null);
  const [resetting, setResetting] = useState<ManagerListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManagerListItem | null>(null);

  async function handleToggleStatus(manager: ManagerListItem) {
    const result = await toggleManagerStatus(manager.id);
    if (result?.error) {
      toast.error(result.error);
    } else {
      toast.success(result?.status === "ACTIVE" ? "Manager activated" : "Manager deactivated");
    }
  }

  const columns = useMemo(
    () =>
      buildManagerColumns({
        onEdit: setEditing,
        onTransfer: setTransferring,
        onResetPassword: setResetting,
        onToggleStatus: handleToggleStatus,
        onDelete: setDeleteTarget,
      }),
    []
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={managers}
        searchPlaceholder="Search by name or email..."
        emptyIcon={<UsersIcon />}
        emptyTitle="No managers yet"
        toolbar={
          <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New Manager
          </Button>
        }
      />

      <CreateManagerDialog open={createOpen} onOpenChange={setCreateOpen} stores={stores} />
      {editing && (
        <EditManagerDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} manager={editing} />
      )}
      {transferring && (
        <TransferManagerDialog
          open={!!transferring}
          onOpenChange={(o) => !o && setTransferring(null)}
          manager={transferring}
          stores={stores}
        />
      )}
      {resetting && (
        <ResetPasswordDialog
          open={!!resetting}
          onOpenChange={(o) => !o && setResetting(null)}
          userName={resetting.name}
          onReset={() => resetManagerPassword(resetting.id)}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title={`Delete "${deleteTarget.name}"?`}
          description="If this manager has related store history, they will be deactivated instead of deleted to preserve records."
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            const result = await deleteManager(deleteTarget.id);
            if (result?.error) {
              toast.error(result.error);
            } else if (result?.deactivated) {
              toast.success("Manager deactivated (has related history)");
            } else {
              toast.success("Manager deleted");
            }
          }}
        />
      )}
    </>
  );
}
