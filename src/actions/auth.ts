"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { signIn, signOut } from "@/lib/auth";
import { getSessionContext } from "@/lib/store-context";
import { logActivity } from "@/lib/audit";
import { loginSchema } from "@/lib/validations/auth";

export async function loginAction(values: {
  email: string;
  password: string;
  code?: string;
  rememberMe?: boolean;
}) {
  const parsed = loginSchema.safeParse(values);
  if (!parsed.success) {
    return { error: "Enter a valid email and password." };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      ...(parsed.data.code ? { code: parsed.data.code } : {}),
      ...(parsed.data.rememberMe ? { rememberMe: "true" } : {}),
      redirect: false,
    });
    return { success: true as const };
  } catch (error) {
    if (error instanceof CredentialsSignin) {
      switch (error.code) {
        case "two_factor_required":
          return { twoFactorRequired: true as const };
        case "invalid_two_factor_code":
          return { twoFactorRequired: true as const, error: "Invalid verification code." };
        case "account_locked":
          return {
            error: "Too many failed attempts. Your account is temporarily locked — try again in 15 minutes.",
          };
        case "rate_limited":
          return { error: "Too many login attempts. Please wait a few minutes and try again." };
        default:
          return { error: "Invalid email or password." };
      }
    }
    if (error instanceof AuthError) {
      return { error: "Invalid email or password." };
    }
    throw error;
  }
}

export async function logoutAction() {
  const context = await getSessionContext();
  if (context) {
    await logActivity({
      storeId: context.storeId,
      userId: context.userId,
      action: "user.logout",
      entity: "User",
      entityId: context.userId,
    });
  }
  await signOut({ redirect: false });
}
