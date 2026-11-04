"use client";

import { useMemo, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { createManager, updateManager } from "@/actions/managers";
import {
  buildCreateManagerSchema,
  buildUpdateManagerSchema,
  type CreateManagerInput,
  type UpdateManagerInput,
} from "@/lib/validations/manager";
import type { ManagerListItem } from "@/lib/queries/users";

type StoreOption = { id: string; name: string; code: string };

export function CreateManagerDialog({
  open,
  onOpenChange,
  stores,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stores: StoreOption[];
}) {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("people.managers.createDialog");
  const tCommon = useTranslations("common");
  const tValidation = useTranslations("validation");
  const createManagerSchema = useMemo(() => buildCreateManagerSchema(tValidation), [tValidation]);
  const form = useForm<CreateManagerInput>({
    resolver: zodResolver(createManagerSchema),
    defaultValues: { name: "", email: "", password: "", phone: "", storeId: "" },
  });

  function onSubmit(values: CreateManagerInput) {
    startTransition(async () => {
      const result = await createManager(values);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(t("toastCreated"));
      onOpenChange(false);
      form.reset();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.name}>
              <FieldLabel htmlFor="new-mgr-name">{t("fullNameLabel")}</FieldLabel>
              <Input id="new-mgr-name" {...form.register("name")} />
              {form.formState.errors.name && <FieldError>{form.formState.errors.name.message}</FieldError>}
            </Field>
            <Field data-invalid={!!form.formState.errors.email}>
              <FieldLabel htmlFor="new-mgr-email">{t("emailLabel")}</FieldLabel>
              <Input id="new-mgr-email" type="email" {...form.register("email")} />
              {form.formState.errors.email && <FieldError>{form.formState.errors.email.message}</FieldError>}
            </Field>
            <Field data-invalid={!!form.formState.errors.password}>
              <FieldLabel htmlFor="new-mgr-password">{t("tempPasswordLabel")}</FieldLabel>
              <Input id="new-mgr-password" {...form.register("password")} />
              {form.formState.errors.password && (
                <FieldError>{form.formState.errors.password.message}</FieldError>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="new-mgr-phone">{t("phoneLabel")}</FieldLabel>
                <Input id="new-mgr-phone" {...form.register("phone")} />
              </Field>
              <Field data-invalid={!!form.formState.errors.storeId}>
                <FieldLabel>{t("storeLabel")}</FieldLabel>
                <Controller
                  control={form.control}
                  name="storeId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("storePlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {stores.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name} ({s.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {form.formState.errors.storeId && (
                  <FieldError>{form.formState.errors.storeId.message}</FieldError>
                )}
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditManagerDialog({
  open,
  onOpenChange,
  manager,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manager: ManagerListItem;
}) {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("people.managers.editDialog");
  const tFields = useTranslations("people.managers.createDialog");
  const tCommon = useTranslations("common");
  const tValidation = useTranslations("validation");
  const updateManagerSchema = useMemo(() => buildUpdateManagerSchema(tValidation), [tValidation]);
  const form = useForm<UpdateManagerInput>({
    resolver: zodResolver(updateManagerSchema),
    values: { name: manager.name, email: manager.email, phone: manager.phone ?? "" },
  });

  function onSubmit(values: UpdateManagerInput) {
    startTransition(async () => {
      const result = await updateManager(manager.id, values);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(t("toastUpdated"));
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.name}>
              <FieldLabel htmlFor="edit-mgr-name">{tFields("fullNameLabel")}</FieldLabel>
              <Input id="edit-mgr-name" {...form.register("name")} />
              {form.formState.errors.name && <FieldError>{form.formState.errors.name.message}</FieldError>}
            </Field>
            <Field data-invalid={!!form.formState.errors.email}>
              <FieldLabel htmlFor="edit-mgr-email">{tFields("emailLabel")}</FieldLabel>
              <Input id="edit-mgr-email" type="email" {...form.register("email")} />
              {form.formState.errors.email && <FieldError>{form.formState.errors.email.message}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-mgr-phone">{tFields("phoneLabel")}</FieldLabel>
              <Input id="edit-mgr-phone" {...form.register("phone")} />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {t("saveChanges")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
