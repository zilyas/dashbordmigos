"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setLocale } from "@/actions/account";
import type { Locale } from "@/generated/prisma/enums";

const LOCALES: Locale[] = ["EN", "FR"];

export function LocaleSelect({ locale }: { locale: Locale }) {
  const t = useTranslations("account.localeSelect");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onChange(value: string) {
    const next = value as Locale;
    startTransition(async () => {
      const result = await setLocale(next);
      if (!result || "error" in result) {
        toast.error(result?.error ?? t("toastFailed"));
        return;
      }
      // The dashboard's language is read server-side from the DB on every
      // render (see (dashboard)/layout.tsx), not from client state -- a
      // refresh is what actually applies the new locale.
      router.refresh();
    });
  }

  return (
    <Select value={locale} onValueChange={onChange} disabled={isPending}>
      <SelectTrigger className="w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LOCALES.map((value) => (
          <SelectItem key={value} value={value}>
            {t(value.toLowerCase())}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
