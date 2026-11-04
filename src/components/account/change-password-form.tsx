"use client";

import { useMemo, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { changePassword } from "@/actions/account";
import {
  buildChangePasswordSchema,
  type ChangePasswordInput,
} from "@/lib/validations/password";

export function ChangePasswordForm() {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("account.changePassword");
  const tValidation = useTranslations("validation");
  const changePasswordSchema = useMemo(
    () => buildChangePasswordSchema(tValidation),
    [tValidation]
  );

  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  function onSubmit(values: ChangePasswordInput) {
    startTransition(async () => {
      const result = await changePassword(values);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(t("toastUpdated"));
      form.reset();
    });
  }

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-sm">
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.currentPassword}>
              <FieldLabel htmlFor="currentPassword">{t("currentPasswordLabel")}</FieldLabel>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!form.formState.errors.currentPassword}
                {...form.register("currentPassword")}
              />
              {form.formState.errors.currentPassword && (
                <FieldError>{form.formState.errors.currentPassword.message}</FieldError>
              )}
            </Field>

            <Field data-invalid={!!form.formState.errors.newPassword}>
              <FieldLabel htmlFor="newPassword">{t("newPasswordLabel")}</FieldLabel>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!form.formState.errors.newPassword}
                {...form.register("newPassword")}
              />
              <FieldDescription>{tValidation("password.policyHint")}</FieldDescription>
              {form.formState.errors.newPassword && (
                <FieldError>{form.formState.errors.newPassword.message}</FieldError>
              )}
            </Field>

            <Field data-invalid={!!form.formState.errors.confirmPassword}>
              <FieldLabel htmlFor="confirmPassword">{t("confirmPasswordLabel")}</FieldLabel>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!form.formState.errors.confirmPassword}
                {...form.register("confirmPassword")}
              />
              {form.formState.errors.confirmPassword && (
                <FieldError>{form.formState.errors.confirmPassword.message}</FieldError>
              )}
            </Field>

            <Button type="submit" className="w-fit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {t("submit")}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
