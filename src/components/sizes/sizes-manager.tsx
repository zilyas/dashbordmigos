"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Plus, Ruler, Pencil, Trash2, Loader2, Check } from "lucide-react";
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
import { buildSizeSchema, type SizeInput } from "@/lib/validations/size";
import { matchesAny } from "@/lib/text";
import type { SizeListItem } from "@/lib/queries/sizes";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

/**
 * Standard size scales, offered as a grid so nobody has to type (or misspell)
 * a size name. `position` keeps the scale in its natural order, which is what
 * the sort field is for — S before M before L, 36 before 38.
 * ponytail: fixed list — add a store-level scale only if a store asks for one.
 */
const SIZE_SCALES = [
  { key: "letter", names: ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"] },
  { key: "numericEu", names: ["34", "36", "38", "40", "42", "44", "46", "48", "50"] },
  { key: "waistIn", names: ["28", "29", "30", "31", "32", "33", "34", "36", "38"] },
  { key: "shoesEu", names: ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45"] },
  { key: "kidsYears", names: ["2Y", "3Y", "4Y", "5Y", "6Y", "8Y", "10Y", "12Y", "14Y"] },
  { key: "oneSize", names: ["One Size"] },
] as const;

export function SizesManager({ sizes }: { sizes: SizeListItem[] }) {
  const t = useTranslations("catalog.sizes");
  const tCommon = useTranslations("common");
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
            placeholder={t("searchPlaceholder")}
            className="pl-9"
          />
        </div>
        <Button onClick={openCreate} className="gap-1.5">
          <Plus className="size-4" />
          {t("newSize")}
        </Button>
      </div>

      {sizes.length === 0 ? (
        <EmptyState
          icon={<Ruler />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <Button onClick={openCreate} size="sm">
              {t("newSize")}
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Search />} title={t("emptySearchTitle")} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((size) => (
            <div key={size.id} className="flex items-start justify-between gap-2 rounded-xl border bg-card p-4 shadow-sm">
              <div>
                <p className="font-medium">{size.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t("variantCount", { count: size.variantCount })}
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

      <SizeDialog open={dialogOpen} onOpenChange={setDialogOpen} size={editing} sizes={sizes} />

      {deleteTarget && (
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title={t("deleteTitle", { name: deleteTarget.name })}
          description={
            deleteTarget.variantCount > 0
              ? t("deleteDescriptionWithVariants", { count: deleteTarget.variantCount })
              : t("deleteDescriptionEmpty")
          }
          confirmLabel={tCommon("delete")}
          destructive
          onConfirm={async () => {
            const result = await deleteSize(deleteTarget.id);
            if (result?.error) toast.error(result.error);
            else toast.success(t("toastDeleted"));
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
  sizes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size: SizeListItem | null;
  sizes: SizeListItem[];
}) {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("catalog.sizes.dialog");
  const tScales = useTranslations("catalog.sizes.scales");
  const tCommon = useTranslations("common");
  const tValidation = useTranslations("validation");
  const sizeSchema = useMemo(() => buildSizeSchema(tValidation), [tValidation]);
  const form = useForm<SizeInput>({
    resolver: zodResolver(sizeSchema),
    values: { name: size?.name ?? "", position: size?.position ?? 0 },
  });

  const name = useWatch({ control: form.control, name: "name" }) ?? "";

  // A name already in the store cannot be created again, so show it as taken
  // instead of letting the server reject the submit. The size being edited
  // keeps its own name selectable.
  const taken = useMemo(
    () => new Set(sizes.filter((s) => s.id !== size?.id).map((s) => s.name.toLowerCase())),
    [sizes, size?.id]
  );

  // The index in the scale becomes the sort order, so a picked scale lists in
  // its natural order without anyone counting by hand.
  function pickPreset(preset: string, index: number) {
    form.setValue("name", preset, { shouldValidate: true });
    form.setValue("position", index, { shouldValidate: true });
  }

  function onSubmit(values: SizeInput) {
    startTransition(async () => {
      const result = size ? await updateSize(size.id, values) : await createSize(values);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(size ? t("toastUpdated") : t("toastCreated"));
      onOpenChange(false);
      form.reset();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{size ? t("editTitle") : t("newTitle")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.name}>
              <FieldLabel>{t("pickLabel")}</FieldLabel>
              <div className="flex flex-col gap-3">
                {SIZE_SCALES.map((scale) => (
                  <div key={scale.key} className="flex flex-col gap-1.5">
                    <p className="text-xs font-medium text-muted-foreground">{tScales(scale.key)}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {scale.names.map((preset, index) => {
                        const isTaken = taken.has(preset.toLowerCase());
                        const selected = name.toLowerCase() === preset.toLowerCase();
                        return (
                          <button
                            key={`${scale.key}-${preset}`}
                            type="button"
                            disabled={isTaken}
                            title={isTaken ? t("alreadyExists", { name: preset }) : preset}
                            aria-pressed={selected}
                            onClick={() => pickPreset(preset, index)}
                            className={cn(
                              "inline-flex h-8 min-w-10 items-center justify-center gap-1 rounded-md border px-2.5 text-sm transition-colors",
                              "hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              selected && "border-primary bg-primary/10 font-medium text-primary",
                              isTaken && "cursor-not-allowed opacity-40 hover:border-border"
                            )}
                          >
                            {selected && <Check className="size-3" />}
                            {preset}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </Field>
            <Field data-invalid={!!form.formState.errors.name}>
              <FieldLabel htmlFor="size-name">{t("nameLabel")}</FieldLabel>
              <Input id="size-name" placeholder={t("namePlaceholder")} {...form.register("name")} />
              {form.formState.errors.name && <FieldError>{form.formState.errors.name.message}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="size-position">{t("sortOrderLabel")}</FieldLabel>
              <Input id="size-position" type="number" {...form.register("position", { valueAsNumber: true })} />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {size ? t("saveChanges") : t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
