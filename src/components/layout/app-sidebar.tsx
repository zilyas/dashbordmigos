"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, Sparkles } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { navItemsForRole } from "@/lib/nav-config";
import type { StoreFeatures } from "@/lib/features";
import type { Role } from "@/generated/prisma/enums";

export function AppSidebar({
  role,
  unreadMessageCount = 0,
  features,
}: {
  role: Role;
  unreadMessageCount?: number;
  features?: StoreFeatures;
}) {
  const pathname = usePathname();
  const items = navItemsForRole(role, features);
  const { isMobile, setOpenMobile } = useSidebar();

  function closeOnMobile() {
    if (isMobile) setOpenMobile(false);
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 px-3 py-3">
        <Link href="/dashboard" onClick={closeOnMobile} className="flex items-center gap-2 px-1">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            Store OS
          </span>
        </Link>
        {role !== "SUPER_ADMIN" && (
          <Button asChild size="sm" className="justify-start gap-2 group-data-[collapsible=icon]:justify-center">
            <Link href="/sales/new" onClick={closeOnMobile}>
              <Plus className="size-4" />
              <span className="group-data-[collapsible=icon]:hidden">New Sale</span>
            </Link>
          </Button>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
                      <Link href={item.href} onClick={closeOnMobile}>
                        <item.icon />
                        <span>{item.title}</span>
                        {item.href === "/messages" && unreadMessageCount > 0 && (
                          <span className="ml-auto flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground group-data-[collapsible=icon]:hidden">
                            {unreadMessageCount > 99 ? "99+" : unreadMessageCount}
                          </span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-3 py-3 text-[11px] text-muted-foreground group-data-[collapsible=icon]:hidden">
        Store Management Dashboard
      </SidebarFooter>
    </Sidebar>
  );
}
