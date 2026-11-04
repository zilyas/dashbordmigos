"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", i18nKey: "light", icon: Sun },
  { value: "dark", i18nKey: "dark", icon: Moon },
  { value: "system", i18nKey: "system", icon: Monitor },
] as const;

export function ThemeSettings() {
  const t = useTranslations("settings.appearance");
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="grid grid-cols-3 gap-3">
          {OPTIONS.map((opt) => {
            const active = mounted && theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTheme(opt.value)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border p-4 text-sm transition-colors",
                  active ? "border-primary bg-primary/5 text-primary" : "hover:bg-accent"
                )}
              >
                <opt.icon className="size-5" />
                {t(opt.i18nKey)}
                {active && <Check className="size-3.5" />}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
