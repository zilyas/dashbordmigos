import { z } from "zod";

const PASSWORD_MIN_LENGTH = 10;

/** Resolved via useTranslations("validation") / getTranslations("validation"). */
import type { ValidationT } from "@/lib/validations/types";

export function buildPasswordPolicySchema(t: ValidationT) {
  return z
    .string()
    .min(PASSWORD_MIN_LENGTH, t("password.minLength", { min: PASSWORD_MIN_LENGTH }))
    .max(128, t("password.maxLength"))
    .refine((v) => /[a-z]/.test(v), t("password.lowercase"))
    .refine((v) => /[A-Z]/.test(v), t("password.uppercase"))
    .refine((v) => /[0-9]/.test(v), t("password.number"))
    .refine((v) => /[^A-Za-z0-9]/.test(v), t("password.symbol"));
}

export function buildForgotPasswordSchema(t: ValidationT) {
  return z.object({
    email: z.email(t("email.invalid")),
  });
}
export type ForgotPasswordInput = z.infer<ReturnType<typeof buildForgotPasswordSchema>>;

export function buildResetPasswordSchema(t: ValidationT) {
  return z
    .object({
      token: z.string().min(1),
      password: buildPasswordPolicySchema(t),
      confirmPassword: z.string(),
    })
    .refine((v) => v.password === v.confirmPassword, {
      message: t("password.mismatch"),
      path: ["confirmPassword"],
    });
}
export type ResetPasswordInput = z.infer<ReturnType<typeof buildResetPasswordSchema>>;

export function buildChangePasswordSchema(t: ValidationT) {
  return z
    .object({
      currentPassword: z.string().min(1, t("password.currentRequired")),
      newPassword: buildPasswordPolicySchema(t),
      confirmPassword: z.string(),
    })
    .refine((v) => v.newPassword === v.confirmPassword, {
      message: t("password.mismatch"),
      path: ["confirmPassword"],
    })
    .refine((v) => v.currentPassword !== v.newPassword, {
      message: t("password.mustDiffer"),
      path: ["newPassword"],
    });
}
export type ChangePasswordInput = z.infer<ReturnType<typeof buildChangePasswordSchema>>;
