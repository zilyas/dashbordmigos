"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Palette, Pencil, Trash2, Loader2, Check } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useMemo } from "react";

/**
 * Common clothing colors, offered as a grid so nobody has to know hex codes.
 * `dark` says the swatch needs a light check mark.
 * ponytail: fixed list — add a store-level palette only if a store asks for one.
 */
const SWATCHES = [
  { name: "Black", hex: "#000000", dark: true },
  { name: "Charcoal", hex: "#36454f", dark: true },
  { name: "Grey", hex: "#808080", dark: true },
  { name: "Silver", hex: "#c0c0c0", dark: false },
  { name: "White", hex: "#ffffff", dark: false },
  { name: "Ivory", hex: "#fffff0", dark: false },
  { name: "Beige", hex: "#f5f5dc", dark: false },
  { name: "Brown", hex: "#8b4513", dark: true },
  { name: "Tan", hex: "#d2b48c", dark: false },
  { name: "Gold", hex: "#ffd700", dark: false },
  { name: "Yellow", hex: "#ffeb3b", dark: false },
  { name: "Orange", hex: "#ff9800", dark: false },
  { name: "Red", hex: "#e53935", dark: true },
  { name: "Burgundy", hex: "#800020", dark: true },
  { name: "Pink", hex: "#ff80ab", dark: false },
  { name: "Purple", hex: "#8e24aa", dark: true },
  { name: "Navy", hex: "#001f3f", dark: true },
  { name: "Blue", hex: "#1e88e5", dark: true },
  { name: "Sky", hex: "#81d4fa", dark: false },
  { name: "Teal", hex: "#009688", dark: true },
  { name: "Green", hex: "#43a047", dark: true },
  { name: "Olive", hex: "#808000", dark: true },
  { name: "Mint", hex: "#a5d6a7", dark: false },
  { name: "Khaki", hex: "#bdb76b", dark: false },
] as const;

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

  const hex = useWatch({ control: form.control, name: "hex" }) ?? "";

  // The swatch name is a sensible default, not a lock-in — it only fills an
  // empty field so an existing name is never overwritten.
  function pickSwatch(swatch: (typeof SWATCHES)[number]) {
    form.setValue("hex", swatch.hex, { shouldValidate: true });
    if (!form.getValues("name").trim()) form.setValue("name", swatch.name, { shouldValidate: true });
  }

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
              <FieldLabel>Swatch (optional)</FieldLabel>
              <div className="grid grid-cols-8 gap-2">
                {SWATCHES.map((s) => (
                  <button
                    key={s.hex}
                    type="button"
                    title={s.name}
                    aria-label={s.name}
                    aria-pressed={hex.toLowerCase() === s.hex}
                    onClick={() => pickSwatch(s)}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full border transition-transform",
                      "hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      hex.toLowerCase() === s.hex && "ring-2 ring-ring ring-offset-2"
                    )}
                    style={{ backgroundColor: s.hex }}
                  >
                    {hex.toLowerCase() === s.hex && (
                      <Check className={cn("size-4", s.dark ? "text-white" : "text-black")} />
                    )}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="color-hex-picker"
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#000000"}
                  onChange={(e) => form.setValue("hex", e.target.value, { shouldValidate: true })}
                  className="size-9 cursor-pointer rounded-md border bg-transparent p-1"
                  aria-label="Pick a custom color"
                />
                <Input
                  id="color-hex"
                  placeholder="#1A2B3C"
                  className="font-mono"
                  {...form.register("hex")}
                />
                {hex && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => form.setValue("hex", "")}>
                    Clear
                  </Button>
                )}
              </div>
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
