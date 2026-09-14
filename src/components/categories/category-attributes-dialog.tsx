"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  createAttributeDefinition,
  updateAttributeDefinition,
  deleteAttributeDefinition,
} from "@/actions/category-attributes";
import {
  attributeDefinitionSchema,
  type AttributeDefinitionInput,
} from "@/lib/validations/category-attribute";
import { ATTRIBUTE_TYPES, ATTRIBUTE_TYPE_LABELS } from "@/lib/attributes";
import type { CategoryAttribute, CategoryListItem } from "@/lib/queries/categories";

export function CategoryAttributesDialog({
  category,
  open,
  onOpenChange,
}: {
  category: CategoryListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<CategoryAttribute | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CategoryAttribute | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Attributes · {category.name}</DialogTitle>
          <DialogDescription>
            Define specification fields (brand, warranty, weight…) for products in this category.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col divide-y">
          {category.attributes.length === 0 && (
            <p className="py-3 text-sm text-muted-foreground">No attributes defined yet.</p>
          )}
          {category.attributes.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {a.label}
                  {a.required && <span className="text-destructive"> *</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {ATTRIBUTE_TYPE_LABELS[a.type]}
                  {a.type === "SELECT" ? ` · ${a.options.length} option(s)` : ""}
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    setEditing(a);
                    setShowForm(true);
                  }}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(a)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {showForm ? (
          <AttributeForm
            key={editing?.id ?? "new"}
            categoryId={category.id}
            attribute={editing}
            onDone={() => {
              setShowForm(false);
              setEditing(null);
              router.refresh();
            }}
            onCancel={() => {
              setShowForm(false);
              setEditing(null);
            }}
          />
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-fit gap-1.5"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            <Plus className="size-4" />
            Add attribute
          </Button>
        )}

        {deleteTarget && (
          <ConfirmDialog
            open={!!deleteTarget}
            onOpenChange={(o) => !o && setDeleteTarget(null)}
            title={`Delete "${deleteTarget.label}"?`}
            description="Any product values stored for this attribute will be removed."
            confirmLabel="Delete"
            destructive
            onConfirm={async () => {
              const result = await deleteAttributeDefinition(deleteTarget.id);
              if (result?.error) toast.error(result.error);
              else {
                toast.success("Attribute deleted");
                router.refresh();
              }
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AttributeForm({
  categoryId,
  attribute,
  onDone,
  onCancel,
}: {
  categoryId: string;
  attribute: CategoryAttribute | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const form = useForm<AttributeDefinitionInput>({
    resolver: zodResolver(attributeDefinitionSchema),
    defaultValues: {
      label: attribute?.label ?? "",
      type: attribute?.type ?? "TEXT",
      options: attribute?.options ?? [],
      required: attribute?.required ?? false,
      position: attribute?.position ?? 0,
    },
  });
  const type = useWatch({ control: form.control, name: "type" });

  function onSubmit(values: AttributeDefinitionInput) {
    startTransition(async () => {
      const result = attribute
        ? await updateAttributeDefinition(attribute.id, values)
        : await createAttributeDefinition(categoryId, values);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(attribute ? "Attribute updated" : "Attribute added");
      onDone();
    });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="rounded-lg border p-3">
      <FieldGroup>
        <div className="grid grid-cols-2 gap-3">
          <Field data-invalid={!!form.formState.errors.label}>
            <FieldLabel htmlFor="attr-label">Label</FieldLabel>
            <Input id="attr-label" placeholder="e.g. Brand" {...form.register("label")} />
            {form.formState.errors.label && (
              <FieldError>{form.formState.errors.label.message}</FieldError>
            )}
          </Field>
          <Field>
            <FieldLabel>Type</FieldLabel>
            <Controller
              control={form.control}
              name="type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ATTRIBUTE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {ATTRIBUTE_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
        </div>

        {type === "SELECT" && (
          <Field data-invalid={!!form.formState.errors.options}>
            <FieldLabel htmlFor="attr-options">Options (one per line)</FieldLabel>
            <Controller
              control={form.control}
              name="options"
              render={({ field }) => (
                <Textarea
                  id="attr-options"
                  rows={3}
                  placeholder={"128GB\n256GB\n512GB"}
                  value={(field.value ?? []).join("\n")}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value.split("\n").map((s) => s.trim()).filter(Boolean)
                    )
                  }
                />
              )}
            />
            {form.formState.errors.options && (
              <FieldError>{form.formState.errors.options.message}</FieldError>
            )}
          </Field>
        )}

        <div className="flex items-center justify-between gap-4">
          <Controller
            control={form.control}
            name="required"
            render={({ field }) => (
              <label className="flex items-center gap-2 text-sm font-medium">
                <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                Required
              </label>
            )}
          />
          <Field className="w-28">
            <FieldLabel htmlFor="attr-position">Order</FieldLabel>
            <Input
              id="attr-position"
              type="number"
              {...form.register("position", { valueAsNumber: true })}
            />
          </Field>
        </div>
      </FieldGroup>

      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending && <Loader2 className="size-4 animate-spin" />}
          {attribute ? "Save" : "Add"}
        </Button>
      </div>
    </form>
  );
}
