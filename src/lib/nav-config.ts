import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Package,
  Tags,
  Ruler,
  Palette,
  SlidersHorizontal,
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
  Plug,
} from "lucide-react";
import type { Role } from "@/generated/prisma/enums";
import type { StoreFeatures } from "@/lib/features";

export type NavItem = {
  /** Key into the "nav" message namespace (messages/en/nav.json) — resolved via useTranslations("nav") in app-sidebar.tsx. */
  titleKey: string;
  href: string;
  icon: LucideIcon;
  roles: Role[];
  /** When set, the item only shows if this store feature flag is on. */
  feature?: keyof StoreFeatures;
};

export const NAV_ITEMS: NavItem[] = [
  { titleKey: "dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["SUPER_ADMIN", "MANAGER", "SELLER"] },
  { titleKey: "messages", href: "/messages", icon: MessageSquare, roles: ["SUPER_ADMIN", "MANAGER", "SELLER"] },
  { titleKey: "announcements", href: "/announcements", icon: Megaphone, roles: ["SUPER_ADMIN", "MANAGER", "SELLER"] },
  { titleKey: "stores", href: "/stores", icon: Store, roles: ["SUPER_ADMIN"] },
  { titleKey: "managers", href: "/managers", icon: Users, roles: ["SUPER_ADMIN"] },
  { titleKey: "products", href: "/products", icon: Package, roles: ["MANAGER", "SELLER"] },
  { titleKey: "categories", href: "/categories", icon: Tags, roles: ["MANAGER"] },
  { titleKey: "sizes", href: "/sizes", icon: Ruler, roles: ["MANAGER"] },
  { titleKey: "colors", href: "/colors", icon: Palette, roles: ["MANAGER"] },
  {
    titleKey: "variantAxes",
    href: "/variant-axes",
    icon: SlidersHorizontal,
    roles: ["MANAGER"],
    feature: "custom_variant_axes_enabled",
  },
  { titleKey: "sales", href: "/sales", icon: ShoppingCart, roles: ["MANAGER", "SELLER"] },
  { titleKey: "reports", href: "/reports", icon: BarChart3, roles: ["SUPER_ADMIN", "MANAGER"] },
  { titleKey: "sellers", href: "/users", icon: Users, roles: ["MANAGER"] },
  { titleKey: "activity", href: "/activity", icon: History, roles: ["SUPER_ADMIN", "MANAGER"] },
  {
    titleKey: "storefrontApi",
    href: "/integrations",
    icon: Plug,
    roles: ["MANAGER"],
    feature: "storefront_api_enabled",
  },
  { titleKey: "settings", href: "/settings", icon: Settings, roles: ["MANAGER"] },
  { titleKey: "backups", href: "/backups", icon: DatabaseBackup, roles: ["SUPER_ADMIN"] },
  { titleKey: "security", href: "/security", icon: ShieldCheck, roles: ["SUPER_ADMIN"] },
];

export function navItemsForRole(role: Role, features?: StoreFeatures): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => item.roles.includes(role) && (!item.feature || features?.[item.feature] === true)
  );
}
