"use client";

import { useMemo, useState, useTransition } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, SlidersHorizontal, Pencil, Trash2, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { createVariantAxis, deleteVariantAxis, updateVariantAxis } from "@/actions/variant-axes";
import { variantAxisSchema, type VariantAxisInput } from "@/lib/validations/variant-axis";
import { matchesAny } from "@/lib/text";
import type { VariantAxisItem } from "@/lib/queries/variant-axes";

export function VariantAxesManager({ axes }: { axes: VariantAxisItem[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<VariantAxisItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VariantAxisItem | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () => axes.filter((a) => matchesAny([a.label, a.key], query)),
    [axes, query]
  );

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search axes..."
            className="pl-9"
          />
        </div>
        <Button onClick={openCreate} className="gap-1.5">
          <Plus className="size-4" />
          New Axis
        </Button>
      </div>

      {axes.length === 0 ? (
        <EmptyState
          icon={<SlidersHorizontal />}
          title="No variant axes yet"
          description="Define custom axes (Storage, Voltage, Flavor…) for variant products."
          action={
            <Button onClick={openCreate} size="sm">
              New Axis
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Search />} title="No axes match your search" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((axis) => (
            <div key={axis.id} className="flex items-start justify-between gap-2 rounded-xl border bg-card p-4 shadow-sm">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="font-medium">{axis.label}</p>
                  {!axis.isActive && <StatusBadge variant="neutral">Inactive</StatusBadge>}
                </div>
                <p className="text-xs text-muted-foreground">key: {axis.key}</p>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon-sm" onClick={() => { setEditing(axis); setDialogOpen(true); }}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(axis)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AxisDialog key={editing?.id ?? "new"} open={dialogOpen} onOpenChange={setDialogOpen} axis={editing} />

      {deleteTarget && (
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title={`Delete "${deleteTarget.label}"?`}
          description="Existing variant values under this axis will simply stop being shown."
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            const result = await deleteVariantAxis(deleteTarget.id);
            if (result?.error) toast.error(result.error);
            else toast.success("Axis deleted");
          }}
        />
      )}
    </div>
  );
}

function AxisDialog({
  open,
  onOpenChange,
  axis,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  axis: VariantAxisItem | null;
}) {
  const [isPending, startTransition] = useTransition();
  const form = useForm<VariantAxisInput>({
    resolver: zodResolver(variantAxisSchema),
    values: {
      label: axis?.label ?? "",
      position: axis?.position ?? 0,
      isActive: axis?.isActive ?? true,
    },
  });

  function onSubmit(values: VariantAxisInput) {
    startTransition(async () => {
      const result = axis ? await updateVariantAxis(axis.id, values) : await createVariantAxis(values);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(axis ? "Axis updated" : "Axis created");
      onOpenChange(false);
      form.reset();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{axis ? "Edit axis" : "New axis"}</DialogTitle>
          <DialogDescription>Axes are shared across this store&apos;s variant products.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.label}>
              <FieldLabel htmlFor="axis-label">Label</FieldLabel>
              <Input id="axis-label" placeholder="e.g. Storage" {...form.register("label")} />
              {form.formState.errors.label && <FieldError>{form.formState.errors.label.message}</FieldError>}
            </Field>
            <div className="flex items-center justify-between gap-4">
              <Controller
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                    Active
                  </label>
                )}
              />
              <Field className="w-28">
                <FieldLabel htmlFor="axis-position">Sort order</FieldLabel>
                <Input id="axis-position" type="number" {...form.register("position", { valueAsNumber: true })} />
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {axis ? "Save changes" : "Create axis"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
