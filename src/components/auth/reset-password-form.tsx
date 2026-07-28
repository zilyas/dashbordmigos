"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { resetPassword } from "@/actions/password-reset";
import {
  resetPasswordSchema,
  PASSWORD_POLICY_HINT,
  type ResetPasswordInput,
} from "@/lib/validations/password";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: "", confirmPassword: "" },
  });

  function onSubmit(values: ResetPasswordInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await resetPassword(values);
      if (result?.error) {
        setServerError(result.error);
        return;
      }
      setDone(true);
      toast.success("Password updated");
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-full max-w-sm"
    >
      <div className="mb-8 flex items-center gap-2">
        <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Sparkles className="size-4.5" />
        </div>
        <span className="text-lg font-semibold tracking-tight">Store OS</span>
      </div>

      {done ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <CheckCircle2 className="size-5 text-success" />
            Password updated
          </div>
          <p className="text-sm text-muted-foreground">
            Your password has been changed and you&apos;ve been signed out everywhere else. Sign in
            with your new password below.
          </p>
          <Button className="w-full" onClick={() => router.push("/login")}>
            Continue to sign in
          </Button>
        </div>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            This will sign you out of every other active session.
          </p>

          <form onSubmit={form.handleSubmit(onSubmit)} className="mt-8">
            <FieldGroup>
              <Field data-invalid={!!form.formState.errors.password}>
                <FieldLabel htmlFor="password">New password</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={!!form.formState.errors.password}
                  {...form.register("password")}
                />
                <FieldDescription>{PASSWORD_POLICY_HINT}</FieldDescription>
                {form.formState.errors.password && (
                  <FieldError>{form.formState.errors.password.message}</FieldError>
                )}
              </Field>

              <Field data-invalid={!!form.formState.errors.confirmPassword}>
                <FieldLabel htmlFor="confirmPassword">Confirm password</FieldLabel>
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

              {serverError && (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {serverError}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                Update password
              </Button>
            </FieldGroup>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            <Link href="/login" className="font-medium text-foreground underline-offset-2 hover:underline">
              Back to sign in
            </Link>
          </p>
        </>
      )}
    </motion.div>
  );
}
