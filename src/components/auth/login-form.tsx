"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { BrandMark } from "@/components/shared/brand-mark";
import { loginAction } from "@/actions/auth";
import { loginSchema, type LoginInput } from "@/lib/validations/auth";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", code: "", rememberMe: false },
  });
  const code = useWatch({ control: form.control, name: "code" });
  const rememberMe = useWatch({ control: form.control, name: "rememberMe" });

  function onSubmit(values: LoginInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await loginAction(values);
      if (result?.twoFactorRequired) {
        setNeedsTwoFactor(true);
        setServerError(result.error ?? null);
        return;
      }
      if (result?.error) {
        setServerError(result.error);
        return;
      }
      toast.success("Welcome back");
      router.push(searchParams.get("callbackUrl") || "/dashboard");
      router.refresh();
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-full max-w-sm"
    >
      <BrandMark className="mb-8" />

      <h1 className="text-2xl font-semibold tracking-tight">Sign in to your workspace</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {needsTwoFactor
          ? "Enter the 6-digit code from your authenticator app."
          : "Enter your credentials to access the dashboard."}
      </p>

      <form onSubmit={form.handleSubmit(onSubmit)} className="mt-8">
        <FieldGroup>
          <Field data-invalid={!!form.formState.errors.email}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              disabled={needsTwoFactor}
              aria-invalid={!!form.formState.errors.email}
              {...form.register("email")}
            />
            {form.formState.errors.email && (
              <FieldError>{form.formState.errors.email.message}</FieldError>
            )}
          </Field>

          <Field data-invalid={!!form.formState.errors.password}>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="password">Password</FieldLabel>
              {!needsTwoFactor && (
                <Link
                  href="/forgot-password"
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Forgot password?
                </Link>
              )}
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              disabled={needsTwoFactor}
              aria-invalid={!!form.formState.errors.password}
              {...form.register("password")}
            />
            {form.formState.errors.password && (
              <FieldError>{form.formState.errors.password.message}</FieldError>
            )}
          </Field>

          {needsTwoFactor && (
            <Field data-invalid={!!form.formState.errors.code}>
              <FieldLabel htmlFor="code">
                {useRecoveryCode ? "Recovery code" : "Verification code"}
              </FieldLabel>
              {useRecoveryCode ? (
                <Input
                  id="code"
                  autoComplete="one-time-code"
                  placeholder="XXXX-XXXX-XXXX"
                  autoFocus
                  {...form.register("code")}
                />
              ) : (
                <InputOTP
                  maxLength={6}
                  autoFocus
                  value={code ?? ""}
                  onChange={(value) => form.setValue("code", value)}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              )}
              <button
                type="button"
                onClick={() => {
                  setUseRecoveryCode((v) => !v);
                  form.setValue("code", "");
                }}
                className="w-fit text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {useRecoveryCode ? "Use an authenticator code instead" : "Use a recovery code instead"}
              </button>
              {form.formState.errors.code && (
                <FieldError>{form.formState.errors.code.message}</FieldError>
              )}
            </Field>
          )}

          {!needsTwoFactor && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="rememberMe"
                checked={rememberMe}
                onCheckedChange={(checked) => form.setValue("rememberMe", checked === true)}
              />
              <label
                htmlFor="rememberMe"
                className="cursor-pointer select-none text-sm text-muted-foreground"
              >
                Remember me for 30 days
              </label>
            </div>
          )}

          {serverError && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {needsTwoFactor ? "Verify and continue" : "Sign in"}
          </Button>
        </FieldGroup>
      </form>
    </motion.div>
  );
}
