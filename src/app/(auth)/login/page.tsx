import type { Metadata } from "next";
import { Suspense } from "react";
import { BarChart3, Boxes, ShoppingCart, Users } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

const FEATURES = [
  { icon: BarChart3, text: "Real-time revenue, profit and stock analytics" },
  { icon: Boxes, text: "Full product & inventory control with audit trails" },
  { icon: ShoppingCart, text: "Fast, barcode-ready point of sale" },
  { icon: Users, text: "Multi-store platform for Super Admins, Managers & Sellers" },
];

export default function LoginPage() {
  return (
    <div className="grid flex-1 lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-zinc-950 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, oklch(0.511 0.262 276.966 / 0.5), transparent 55%), radial-gradient(circle at 80% 70%, oklch(0.585 0.233 277.117 / 0.35), transparent 50%)",
          }}
        />
        <div className="relative flex items-center gap-2 text-white">
          <div className="flex size-9 items-center justify-center rounded-xl bg-white/10 backdrop-blur">
            <BarChart3 className="size-4.5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Store OS</span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-white">
            Run every store from one place.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/60">
            Products, inventory, point of sale, and profit — fully isolated
            per store, in a single fast dashboard built for growing chains.
          </p>
          <ul className="mt-8 flex flex-col gap-4">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-white/80">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/40">
          © {new Date().getFullYear()} Store OS. All rights reserved.
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
