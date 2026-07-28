import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Package,
  Tags,
  ShoppingCart,
  Users,
  Store,
  BarChart3,
  History,
  Settings,
  DatabaseBackup,
  ShieldCheck,
  MessageSquare,
  Megaphone,
} from "lucide-react";
import type { Role } from "@/generated/prisma/enums";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  roles: Role[];
};

export const NAV_ITEMS: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["SUPER_ADMIN", "MANAGER", "SELLER"] },
  { title: "Messages", href: "/messages", icon: MessageSquare, roles: ["SUPER_ADMIN", "MANAGER", "SELLER"] },
  { title: "Announcements", href: "/announcements", icon: Megaphone, roles: ["SUPER_ADMIN", "MANAGER", "SELLER"] },
  { title: "Stores", href: "/stores", icon: Store, roles: ["SUPER_ADMIN"] },
  { title: "Managers", href: "/managers", icon: Users, roles: ["SUPER_ADMIN"] },
  { title: "Products", href: "/products", icon: Package, roles: ["MANAGER", "SELLER"] },
  { title: "Categories", href: "/categories", icon: Tags, roles: ["MANAGER"] },
  { title: "Sales", href: "/sales", icon: ShoppingCart, roles: ["MANAGER", "SELLER"] },
  { title: "Reports", href: "/reports", icon: BarChart3, roles: ["SUPER_ADMIN", "MANAGER"] },
  { title: "Sellers", href: "/users", icon: Users, roles: ["MANAGER"] },
  { title: "Activity", href: "/activity", icon: History, roles: ["SUPER_ADMIN", "MANAGER"] },
  { title: "Settings", href: "/settings", icon: Settings, roles: ["MANAGER"] },
  { title: "Backups", href: "/backups", icon: DatabaseBackup, roles: ["SUPER_ADMIN"] },
  { title: "Security", href: "/security", icon: ShieldCheck, roles: ["SUPER_ADMIN"] },
];

export function navItemsForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
