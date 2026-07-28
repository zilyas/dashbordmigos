"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Users as UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ResetPasswordDialog } from "@/components/shared/reset-password-dialog";
import { buildSellerColumns } from "@/components/users/user-columns";
import { CreateSellerDialog, EditSellerDialog } from "@/components/users/user-dialog";
import { deleteSeller, resetSellerPassword, toggleSellerStatus } from "@/actions/users";
import type { SellerListItem } from "@/lib/queries/users";

export function UsersTable({ sellers, currency }: { sellers: SellerListItem[]; currency: string }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<SellerListItem | null>(null);
  const [resetting, setResetting] = useState<SellerListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SellerListItem | null>(null);

  async function handleToggleStatus(seller: SellerListItem) {
    const result = await toggleSellerStatus(seller.id);
    if (result?.error) {
      toast.error(result.error);
    } else {
      toast.success(result?.status === "ACTIVE" ? "Seller activated" : "Seller deactivated");
    }
  }

  const columns = useMemo(
    () =>
      buildSellerColumns({
        currency,
        onEdit: setEditing,
        onResetPassword: setResetting,
        onToggleStatus: handleToggleStatus,
        onDelete: setDeleteTarget,
      }),
    [currency]
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={sellers}
        searchPlaceholder="Search by name or email..."
        emptyIcon={<UsersIcon />}
        emptyTitle="No sellers found"
        toolbar={
          <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New Seller
          </Button>
        }
      />

      <CreateSellerDialog open={createOpen} onOpenChange={setCreateOpen} />
      {editing && (
        <EditSellerDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} seller={editing} />
      )}
      {resetting && (
        <ResetPasswordDialog
          open={!!resetting}
          onOpenChange={(o) => !o && setResetting(null)}
          userName={resetting.name}
          onReset={() => resetSellerPassword(resetting.id)}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title={`Delete "${deleteTarget.name}"?`}
          description="If this seller has made sales, they will be deactivated instead of deleted to preserve records."
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            const result = await deleteSeller(deleteTarget.id);
            if (result?.error) {
              toast.error(result.error);
            } else if (result?.deactivated) {
              toast.success("Seller deactivated (has related history)");
            } else {
              toast.success("Seller deleted");
            }
          }}
        />
      )}
    </>
  );
}
