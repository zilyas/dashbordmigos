import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Reset password",
};

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
      <ForgotPasswordForm />
    </div>
  );
}
