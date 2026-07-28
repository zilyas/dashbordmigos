"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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

const NAV_ICONS = {
  Dashboard: LayoutDashboard,
  Stores: Store,
  Managers: Users,
  Products: Package,
  Categories: Tags,
  Sales: ShoppingCart,
  Reports: BarChart3,
  Sellers: Users,
  Activity: BarChart3,
  Settings: Settings,
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
      <CommandDialog open={open} onOpenChange={setOpen} title="Quick actions">
        <CommandInput placeholder="Search pages and actions..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Quick actions">
            {can(role, "sale.create") && (
              <CommandItem onSelect={() => go("/sales/new")}>
                <Plus />
                New Sale
              </CommandItem>
            )}
            {can(role, "product.create") && (
              <CommandItem onSelect={() => go("/products/new")}>
                <Plus />
                New Product
              </CommandItem>
            )}
            {can(role, "store.manage") && (
              <CommandItem onSelect={() => go("/stores")}>
                <Plus />
                New Store
              </CommandItem>
            )}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Navigate">
            {navItems.map((item) => {
              const Icon = NAV_ICONS[item.title as keyof typeof NAV_ICONS] ?? LayoutDashboard;
              return (
                <CommandItem key={item.href} onSelect={() => go(item.href)}>
                  <Icon />
                  {item.title}
                </CommandItem>
              );
            })}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Tips">
            <CommandItem disabled className="opacity-60">
              Toggle this palette anytime
              <CommandShortcut>⌘K</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </CommandPaletteContext.Provider>
  );
}
