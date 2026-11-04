"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("people.managers");
  const tTable = useTranslations("people.managers.table");
  const tColumns = useTranslations("people.managers.columns");
  const tLabels = useTranslations("labels");
  const tCommon = useTranslations("common");
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
      toast.success(result?.status === "ACTIVE" ? t("toastActivated") : t("toastDeactivated"));
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
        t: tColumns,
        tLabels,
      }),
    [tColumns, tLabels]
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={managers}
        searchPlaceholder={tTable("searchPlaceholder")}
        emptyIcon={<UsersIcon />}
        emptyTitle={tTable("emptyTitle")}
        toolbar={
          <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {tTable("newManager")}
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
          title={t("deleteDialog.title", { name: deleteTarget.name })}
          description={t("deleteDialog.description")}
          confirmLabel={tCommon("delete")}
          destructive
          onConfirm={async () => {
            const result = await deleteManager(deleteTarget.id);
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
