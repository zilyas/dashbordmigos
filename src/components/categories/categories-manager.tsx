"use client";

import { useMemo, useState, useTransition } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Plus, Tags, Pencil, Trash2, Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { createCategory, deleteCategory, updateCategory } from "@/actions/categories";
import { buildCategorySchema, type CategoryInput } from "@/lib/validations/category";
import { CategoryAttributesDialog } from "@/components/categories/category-attributes-dialog";
import type { CategoryListItem } from "@/lib/queries/categories";

export function CategoriesManager({
  categories,
  attributesEnabled = false,
}: {
  categories: CategoryListItem[];
  /** Store has category_attributes_enabled — show the "Manage attributes" action. */
  attributesEnabled?: boolean;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CategoryListItem | null>(null);
  const [attrTargetId, setAttrTargetId] = useState<string | null>(null);
  const t = useTranslations("catalog.categories");
  const tLabels = useTranslations("labels");
  const tCommon = useTranslations("common");
  // Derive the live category from props so the dialog reflects refreshes.
  const attrTarget = categories.find((c) => c.id === attrTargetId) ?? null;

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(category: CategoryListItem) {
    setEditing(category);
    setDialogOpen(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={openCreate} className="gap-1.5">
          <Plus className="size-4" />
          {t("newCategory")}
        </Button>
      </div>

      {categories.length === 0 ? (
        <EmptyState
          icon={<Tags />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <Button onClick={openCreate} size="sm">
              {t("newCategory")}
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <div key={category.id} className="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-medium">{category.name}</p>
                    {!category.isActive && <StatusBadge variant="neutral">{tLabels("userStatus.INACTIVE")}</StatusBadge>}
                    {category.isClothing && <StatusBadge variant="info">{t("clothingBadge")}</StatusBadge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {category.parentName ? `${category.parentName} · ` : ""}
                    {t("productCount", { count: category.productCount })}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => openEdit(category)}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(category)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              {category.description && (
                <p className="text-sm text-muted-foreground">{category.description}</p>
              )}
              {attributesEnabled && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1 h-7 w-fit gap-1.5"
                  onClick={() => setAttrTargetId(category.id)}
                >
                  <SlidersHorizontal className="size-3.5" />
                  {t("attributesButton")}
                  {category.attributes.length > 0 && (
                    <span className="text-xs text-muted-foreground">({category.attributes.length})</span>
                  )}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {attrTarget && (
        <CategoryAttributesDialog
          category={attrTarget}
          open={!!attrTarget}
          onOpenChange={(open) => !open && setAttrTargetId(null)}
        />
      )}

      <CategoryDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        category={editing}
        categories={categories}
      />

      {deleteTarget && (
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title={t("deleteTitle", { name: deleteTarget.name })}
          description={
            deleteTarget.productCount > 0
              ? t("deleteDescriptionWithProducts", { count: deleteTarget.productCount })
              : t("deleteDescriptionEmpty")
          }
          confirmLabel={tCommon("delete")}
          destructive
          onConfirm={async () => {
            const result = await deleteCategory(deleteTarget.id);
            if (result?.error) {
              toast.error(result.error);
            } else {
              toast.success(t("toastDeleted"));
            }
          }}
        />
      )}
    </div>
  );
}

const NO_PARENT = "none";

function CategoryDialog({
  open,
  onOpenChange,
  category,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: CategoryListItem | null;
  categories: CategoryListItem[];
}) {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("catalog.categories.dialog");
  const tCommon = useTranslations("common");
  const tLabels = useTranslations("labels");
  const tValidation = useTranslations("validation");
  const categorySchema = useMemo(() => buildCategorySchema(tValidation), [tValidation]);
  const form = useForm<CategoryInput>({
    resolver: zodResolver(categorySchema),
    values: {
      name: category?.name ?? "",
      description: category?.description ?? "",
      isActive: category?.isActive ?? true,
      parentId: category?.parentId ?? "",
      isClothing: category?.isClothing ?? false,
    },
  });

  // A category cannot be its own parent.
  const parentOptions = categories.filter((c) => c.id !== category?.id);

  function onSubmit(values: CategoryInput) {
    startTransition(async () => {
      const result = category
        ? await updateCategory(category.id, values)
        : await createCategory(values);

      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(category ? t("toastUpdated") : t("toastCreated"));
      onOpenChange(false);
      form.reset();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? t("editTitle") : t("newTitle")}</DialogTitle>
          <DialogDescription>
            {category ? t("editDescription") : t("newDescription")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.name}>
              <FieldLabel htmlFor="cat-name">{t("nameLabel")}</FieldLabel>
              <Input id="cat-name" {...form.register("name")} />
              {form.formState.errors.name && (
                <FieldError>{form.formState.errors.name.message}</FieldError>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="cat-description">{t("descriptionLabel")}</FieldLabel>
              <Textarea id="cat-description" rows={3} {...form.register("description")} />
            </Field>
            <Field>
              <FieldLabel>{t("parentLabel")}</FieldLabel>
              <Controller
                control={form.control}
                name="parentId"
                render={({ field }) => (
                  <Select
                    value={field.value || NO_PARENT}
                    onValueChange={(v) => field.onChange(v === NO_PARENT ? "" : v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("noParent")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PARENT}>{t("noParent")}</SelectItem>
                      {parentOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Controller
              control={form.control}
              name="isClothing"
              render={({ field }) => (
                <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-2.5">
                  <div>
                    <p className="text-sm font-medium">{t("clothingLabel")}</p>
                    <p className="text-xs text-muted-foreground">{t("clothingHint")}</p>
                  </div>
                  <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                </div>
              )}
            />
            <Controller
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-2.5">
                  <span className="text-sm font-medium">{tLabels("userStatus.ACTIVE")}</span>
                  <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                </div>
              )}
            />
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {category ? t("saveChanges") : t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
