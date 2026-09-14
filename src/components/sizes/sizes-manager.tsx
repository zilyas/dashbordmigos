"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Ruler, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
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
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { createSize, deleteSize, updateSize } from "@/actions/sizes";
import { sizeSchema, type SizeInput } from "@/lib/validations/size";
import { matchesAny } from "@/lib/text";
import type { SizeListItem } from "@/lib/queries/sizes";
import { useMemo } from "react";

export function SizesManager({ sizes }: { sizes: SizeListItem[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SizeListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SizeListItem | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => sizes.filter((s) => matchesAny([s.name], query)), [sizes, query]);

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
            placeholder="Search sizes..."
            className="pl-9"
          />
        </div>
        <Button onClick={openCreate} className="gap-1.5">
          <Plus className="size-4" />
          New Size
        </Button>
      </div>

      {sizes.length === 0 ? (
        <EmptyState
          icon={<Ruler />}
          title="No sizes yet"
          description="Add sizes (S, M, L, …) to use them on clothing product variants."
          action={
            <Button onClick={openCreate} size="sm">
              New Size
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Search />} title="No sizes match your search" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((size) => (
            <div key={size.id} className="flex items-start justify-between gap-2 rounded-xl border bg-card p-4 shadow-sm">
              <div>
                <p className="font-medium">{size.name}</p>
                <p className="text-xs text-muted-foreground">
                  {size.variantCount} variant{size.variantCount === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon-sm" onClick={() => { setEditing(size); setDialogOpen(true); }}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(size)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SizeDialog open={dialogOpen} onOpenChange={setDialogOpen} size={editing} />

      {deleteTarget && (
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title={`Delete "${deleteTarget.name}"?`}
          description={
            deleteTarget.variantCount > 0
              ? `This size is used by ${deleteTarget.variantCount} variant(s). Those variants will lose their size.`
              : "This action cannot be undone."
          }
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            const result = await deleteSize(deleteTarget.id);
            if (result?.error) toast.error(result.error);
            else toast.success("Size deleted");
          }}
        />
      )}
    </div>
  );
}

function SizeDialog({
  open,
  onOpenChange,
  size,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size: SizeListItem | null;
}) {
  const [isPending, startTransition] = useTransition();
  const form = useForm<SizeInput>({
    resolver: zodResolver(sizeSchema),
    values: { name: size?.name ?? "", position: size?.position ?? 0 },
  });

  function onSubmit(values: SizeInput) {
    startTransition(async () => {
      const result = size ? await updateSize(size.id, values) : await createSize(values);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(size ? "Size updated" : "Size created");
      onOpenChange(false);
      form.reset();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{size ? "Edit size" : "New size"}</DialogTitle>
          <DialogDescription>Sizes are shared across this store&apos;s variant products.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.name}>
              <FieldLabel htmlFor="size-name">Name</FieldLabel>
              <Input id="size-name" placeholder="e.g. M" {...form.register("name")} />
              {form.formState.errors.name && <FieldError>{form.formState.errors.name.message}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="size-position">Sort order</FieldLabel>
              <Input id="size-position" type="number" {...form.register("position", { valueAsNumber: true })} />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {size ? "Save changes" : "Create size"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
