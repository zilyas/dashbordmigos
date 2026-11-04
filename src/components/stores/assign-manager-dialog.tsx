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
import { createManager } from "@/actions/managers";
import { buildCreateManagerSchema, type CreateManagerInput } from "@/lib/validations/manager";

/** Creates a new Manager pre-assigned to a fixed store (used from the Store detail page). */
export function AssignManagerDialog({
  open,
  onOpenChange,
  storeId,
  storeName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  storeName: string;
}) {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("storeDetail.assignManagerDialog");
  const tFields = useTranslations("people.managers.createDialog");
  const tCommon = useTranslations("common");
  const tValidation = useTranslations("validation");
  const createManagerSchema = useMemo(() => buildCreateManagerSchema(tValidation), [tValidation]);

  const form = useForm<CreateManagerInput>({
    resolver: zodResolver(createManagerSchema),
    defaultValues: { name: "", email: "", password: "", phone: "", storeId },
  });

  function onSubmit(values: CreateManagerInput) {
    startTransition(async () => {
      const result = await createManager(values);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(t("toastAssigned"));
      onOpenChange(false);
      form.reset({ name: "", email: "", password: "", phone: "", storeId });
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { storeName })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <input type="hidden" {...form.register("storeId")} value={storeId} />
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.name}>
              <FieldLabel htmlFor="mgr-name">{tFields("fullNameLabel")}</FieldLabel>
              <Input id="mgr-name" {...form.register("name")} />
              {form.formState.errors.name && <FieldError>{form.formState.errors.name.message}</FieldError>}
            </Field>
            <Field data-invalid={!!form.formState.errors.email}>
              <FieldLabel htmlFor="mgr-email">{tFields("emailLabel")}</FieldLabel>
              <Input id="mgr-email" type="email" {...form.register("email")} />
              {form.formState.errors.email && <FieldError>{form.formState.errors.email.message}</FieldError>}
            </Field>
            <Field data-invalid={!!form.formState.errors.password}>
              <FieldLabel htmlFor="mgr-password">{tFields("tempPasswordLabel")}</FieldLabel>
              <Input id="mgr-password" {...form.register("password")} />
              {form.formState.errors.password && (
                <FieldError>{form.formState.errors.password.message}</FieldError>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="mgr-phone">{tFields("phoneLabel")}</FieldLabel>
              <Input id="mgr-phone" {...form.register("phone")} />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
