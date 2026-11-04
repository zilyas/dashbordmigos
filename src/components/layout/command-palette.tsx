"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, Package, ShoppingCart, LayoutDashboard, Users, BarChart3, Settings, Tags, Store } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { navItemsForRole } from "@/lib/nav-config";
import { can } from "@/lib/rbac";
import type { Role } from "@/generated/prisma/enums";

// Keyed by NavItem.titleKey (src/lib/nav-config.ts), not display text — a
// translated/renamed title must not silently drop an item's icon.
const NAV_ICONS = {
  dashboard: LayoutDashboard,
  stores: Store,
  managers: Users,
  products: Package,
  categories: Tags,
  sales: ShoppingCart,
  sellers: Users,
  activity: BarChart3,
  reports: BarChart3,
  settings: Settings,
} as const;

type CommandPaletteContextValue = { open: boolean; setOpen: (open: boolean) => void };

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function useCommandPalette() {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used within CommandPaletteProvider");
  return ctx;
}

export function CommandPaletteProvider({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const t = useTranslations("nav");
  const tCmd = useTranslations("commandPalette");
  const navItems = navItemsForRole(role);
  const value = useMemo(() => ({ open, setOpen }), [open]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      <CommandDialog open={open} onOpenChange={setOpen} title={tCmd("title")}>
        <CommandInput placeholder={tCmd("searchPlaceholder")} />
        <CommandList>
          <CommandEmpty>{tCmd("noResults")}</CommandEmpty>
          <CommandGroup heading={tCmd("quickActions")}>
            {can(role, "sale.create") && (
              <CommandItem onSelect={() => go("/sales/new")}>
                <Plus />
                {tCmd("newSale")}
              </CommandItem>
            )}
            {can(role, "product.create") && (
              <CommandItem onSelect={() => go("/products/new")}>
                <Plus />
                {tCmd("newProduct")}
              </CommandItem>
            )}
            {can(role, "store.manage") && (
              <CommandItem onSelect={() => go("/stores")}>
                <Plus />
                {tCmd("newStore")}
              </CommandItem>
            )}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading={tCmd("navigate")}>
            {navItems.map((item) => {
              const Icon = NAV_ICONS[item.titleKey as keyof typeof NAV_ICONS] ?? LayoutDashboard;
              return (
                <CommandItem key={item.href} onSelect={() => go(item.href)}>
                  <Icon />
                  {t(item.titleKey)}
                </CommandItem>
              );
            })}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading={tCmd("tips")}>
            <CommandItem disabled className="opacity-60">
              {tCmd("togglePalette")}
              <CommandShortcut>⌘K</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </CommandPaletteContext.Provider>
  );
}
