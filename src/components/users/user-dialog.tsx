"use client";

import { useMemo, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { createSeller, updateSeller } from "@/actions/users";
import {
  buildCreateSellerSchema,
  buildUpdateSellerSchema,
  type CreateSellerInput,
  type UpdateSellerInput,
} from "@/lib/validations/user";
import type { SellerListItem } from "@/lib/queries/users";

export function CreateSellerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("people.users.createDialog");
  const tCommon = useTranslations("common");
  const tValidation = useTranslations("validation");
  const createSellerSchema = useMemo(() => buildCreateSellerSchema(tValidation), [tValidation]);
  const form = useForm<CreateSellerInput>({
    resolver: zodResolver(createSellerSchema),
    defaultValues: { name: "", email: "", password: "", phone: "" },
  });

  function onSubmit(values: CreateSellerInput) {
    startTransition(async () => {
      const result = await createSeller(values);
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
              <FieldLabel htmlFor="new-seller-name">{t("fullNameLabel")}</FieldLabel>
              <Input id="new-seller-name" {...form.register("name")} />
              {form.formState.errors.name && <FieldError>{form.formState.errors.name.message}</FieldError>}
            </Field>
            <Field data-invalid={!!form.formState.errors.email}>
              <FieldLabel htmlFor="new-seller-email">{t("emailLabel")}</FieldLabel>
              <Input id="new-seller-email" type="email" {...form.register("email")} />
              {form.formState.errors.email && <FieldError>{form.formState.errors.email.message}</FieldError>}
            </Field>
            <Field data-invalid={!!form.formState.errors.password}>
              <FieldLabel htmlFor="new-seller-password">{t("tempPasswordLabel")}</FieldLabel>
              <Input id="new-seller-password" {...form.register("password")} />
              {form.formState.errors.password && (
                <FieldError>{form.formState.errors.password.message}</FieldError>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="new-seller-phone">{t("phoneLabel")}</FieldLabel>
              <Input id="new-seller-phone" {...form.register("phone")} />
            </Field>
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

export function EditSellerDialog({
  open,
  onOpenChange,
  seller,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seller: SellerListItem;
}) {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("people.users.editDialog");
  const tFields = useTranslations("people.users.createDialog");
  const tCommon = useTranslations("common");
  const tValidation = useTranslations("validation");
  const updateSellerSchema = useMemo(() => buildUpdateSellerSchema(tValidation), [tValidation]);
  const form = useForm<UpdateSellerInput>({
    resolver: zodResolver(updateSellerSchema),
    values: { name: seller.name, email: seller.email, phone: seller.phone ?? "" },
  });

  function onSubmit(values: UpdateSellerInput) {
    startTransition(async () => {
      const result = await updateSeller(seller.id, values);
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
              <FieldLabel htmlFor="edit-seller-name">{tFields("fullNameLabel")}</FieldLabel>
              <Input id="edit-seller-name" {...form.register("name")} />
              {form.formState.errors.name && <FieldError>{form.formState.errors.name.message}</FieldError>}
            </Field>
            <Field data-invalid={!!form.formState.errors.email}>
              <FieldLabel htmlFor="edit-seller-email">{tFields("emailLabel")}</FieldLabel>
              <Input id="edit-seller-email" type="email" {...form.register("email")} />
              {form.formState.errors.email && <FieldError>{form.formState.errors.email.message}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-seller-phone">{tFields("phoneLabel")}</FieldLabel>
              <Input id="edit-seller-phone" {...form.register("phone")} />
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
