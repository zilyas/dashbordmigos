"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { changePassword } from "@/actions/account";
import {
  changePasswordSchema,
  PASSWORD_POLICY_HINT,
  type ChangePasswordInput,
} from "@/lib/validations/password";

export function ChangePasswordForm() {
  const [isPending, startTransition] = useTransition();

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
      toast.success("Password updated. Your other sessions have been signed out.");
      form.reset();
    });
  }

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle>Change password</CardTitle>
        <CardDescription>Update the password used to sign in to your account.</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-sm">
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.currentPassword}>
              <FieldLabel htmlFor="currentPassword">Current password</FieldLabel>
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
              <FieldLabel htmlFor="newPassword">New password</FieldLabel>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!form.formState.errors.newPassword}
                {...form.register("newPassword")}
              />
              <FieldDescription>{PASSWORD_POLICY_HINT}</FieldDescription>
              {form.formState.errors.newPassword && (
                <FieldError>{form.formState.errors.newPassword.message}</FieldError>
              )}
            </Field>

            <Field data-invalid={!!form.formState.errors.confirmPassword}>
              <FieldLabel htmlFor="confirmPassword">Confirm new password</FieldLabel>
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
              Update password
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
