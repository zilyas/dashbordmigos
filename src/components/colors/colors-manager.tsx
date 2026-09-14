"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Palette, Pencil, Trash2, Loader2 } from "lucide-react";
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
import { createColor, deleteColor, updateColor } from "@/actions/colors";
import { colorSchema, type ColorInput } from "@/lib/validations/color";
import { matchesAny } from "@/lib/text";
import type { ColorListItem } from "@/lib/queries/colors";
import { useMemo } from "react";

export function ColorsManager({ colors }: { colors: ColorListItem[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ColorListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ColorListItem | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () => colors.filter((c) => matchesAny([c.name, c.hex], query)),
    [colors, query]
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
            placeholder="Search colors..."
            className="pl-9"
          />
        </div>
        <Button onClick={openCreate} className="gap-1.5">
          <Plus className="size-4" />
          New Color
        </Button>
      </div>

      {colors.length === 0 ? (
        <EmptyState
          icon={<Palette />}
          title="No colors yet"
          description="Add colors to use them on clothing product variants."
          action={
            <Button onClick={openCreate} size="sm">
              New Color
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Search />} title="No colors match your search" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((color) => (
            <div key={color.id} className="flex items-start justify-between gap-2 rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <span
                  className="size-8 shrink-0 rounded-full border"
                  style={{ backgroundColor: color.hex ?? "transparent" }}
                  aria-hidden
                />
                <div>
                  <p className="font-medium">{color.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {color.hex ?? "no swatch"} · {color.variantCount} variant{color.variantCount === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon-sm" onClick={() => { setEditing(color); setDialogOpen(true); }}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(color)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ColorDialog open={dialogOpen} onOpenChange={setDialogOpen} color={editing} />

      {deleteTarget && (
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title={`Delete "${deleteTarget.name}"?`}
          description={
            deleteTarget.variantCount > 0
              ? `This color is used by ${deleteTarget.variantCount} variant(s). Those variants will lose their color.`
              : "This action cannot be undone."
          }
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            const result = await deleteColor(deleteTarget.id);
            if (result?.error) toast.error(result.error);
            else toast.success("Color deleted");
          }}
        />
      )}
    </div>
  );
}

function ColorDialog({
  open,
  onOpenChange,
  color,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  color: ColorListItem | null;
}) {
  const [isPending, startTransition] = useTransition();
  const form = useForm<ColorInput>({
    resolver: zodResolver(colorSchema),
    values: { name: color?.name ?? "", hex: color?.hex ?? "", position: color?.position ?? 0 },
  });

  function onSubmit(values: ColorInput) {
    startTransition(async () => {
      const result = color ? await updateColor(color.id, values) : await createColor(values);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(color ? "Color updated" : "Color created");
      onOpenChange(false);
      form.reset();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{color ? "Edit color" : "New color"}</DialogTitle>
          <DialogDescription>Colors are shared across this store&apos;s variant products.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.name}>
              <FieldLabel htmlFor="color-name">Name</FieldLabel>
              <Input id="color-name" placeholder="e.g. Noir" {...form.register("name")} />
              {form.formState.errors.name && <FieldError>{form.formState.errors.name.message}</FieldError>}
            </Field>
            <Field data-invalid={!!form.formState.errors.hex}>
              <FieldLabel htmlFor="color-hex">Swatch (hex, optional)</FieldLabel>
              <Input id="color-hex" placeholder="#1A2B3C" {...form.register("hex")} />
              {form.formState.errors.hex && <FieldError>{form.formState.errors.hex.message}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="color-position">Sort order</FieldLabel>
              <Input id="color-position" type="number" {...form.register("position", { valueAsNumber: true })} />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {color ? "Save changes" : "Create color"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
