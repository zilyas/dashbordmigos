"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { ArrowLeft, KeyRound, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { requestPasswordReset } from "@/actions/password-reset";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validations/password";

export function ForgotPasswordForm() {
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<{ message: string; resetLink?: string } | null>(null);

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  function onSubmit(values: ForgotPasswordInput) {
    setServerError(null);
    startTransition(async () => {
      const res = await requestPasswordReset(values);
      if (res.error) {
        setServerError(res.error);
        return;
      }
      setResult({ message: res.message ?? "Check your email for a reset link.", resetLink: res.resetLink });
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

      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Enter your email and we&apos;ll generate a link to reset your password.
      </p>

      {result ? (
        <div className="mt-8 flex flex-col gap-4">
          <div className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
            {result.message}
          </div>
          {result.resetLink && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-primary">
                <KeyRound className="size-3.5" />
                Dev mode — no email provider configured
              </div>
              <Link
                href={result.resetLink}
                className="break-all text-sm font-medium text-primary underline underline-offset-2"
              >
                {result.resetLink}
              </Link>
            </div>
          )}
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">
              <ArrowLeft className="size-4" />
              Back to sign in
            </Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-8">
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.email}>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@store.dev"
                aria-invalid={!!form.formState.errors.email}
                {...form.register("email")}
              />
              {form.formState.errors.email && (
                <FieldError>{form.formState.errors.email.message}</FieldError>
              )}
            </Field>

            {serverError && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {serverError}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Send reset link
            </Button>

            <Button asChild variant="ghost" className="w-full">
              <Link href="/login">
                <ArrowLeft className="size-4" />
                Back to sign in
              </Link>
            </Button>
          </FieldGroup>
        </form>
      )}
    </motion.div>
  );
}
