import type { Role } from "@/generated/prisma/enums";

export type Permission =
  | "product.view"
  | "product.create"
  | "product.edit"
  | "product.delete"
  | "category.manage"
  | "inventory.adjust"
  | "sale.create"
  | "sale.viewOwn"
  | "sale.viewAll"
  | "sale.viewProfit"
  | "seller.manage"
  | "manager.manage"
  | "store.manage"
  | "report.view"
  | "report.export"
  | "settings.manage"
  | "activity.view"
  | "platform.analytics.view"
  | "backup.manage"
  | "security.view"
  | "announcement.manage";

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: [
    "store.manage",
    "manager.manage",
    "platform.analytics.view",
    "product.view",
    "sale.viewAll",
    "sale.viewProfit",
    "report.view",
    "report.export",
    "activity.view",
    "backup.manage",
    "security.view",
    "announcement.manage",
  ],
  MANAGER: [
    "product.view",
    "product.create",
    "product.edit",
    "product.delete",
    "category.manage",
    "inventory.adjust",
    "sale.create",
    "sale.viewOwn",
    "sale.viewAll",
    "sale.viewProfit",
    "seller.manage",
    "report.view",
    "report.export",
    "settings.manage",
    "activity.view",
    "announcement.manage",
  ],
  SELLER: ["product.view", "sale.create", "sale.viewOwn"],
};

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function canAny(role: Role | undefined | null, permissions: Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}

/** Route rules gated purely by role, checked in middleware before any page render. */
export const ROUTE_ROLE_RULES: { test: (pathname: string) => boolean; roles: Role[] }[] = [
  { test: (p) => p.startsWith("/stores"), roles: ["SUPER_ADMIN"] },
  { test: (p) => p.startsWith("/managers"), roles: ["SUPER_ADMIN"] },
  { test: (p) => p.startsWith("/backups"), roles: ["SUPER_ADMIN"] },
  { test: (p) => p.startsWith("/security"), roles: ["SUPER_ADMIN"] },
  { test: (p) => p.startsWith("/settings"), roles: ["MANAGER"] },
  { test: (p) => p.startsWith("/activity"), roles: ["SUPER_ADMIN", "MANAGER"] },
  { test: (p) => p.startsWith("/reports"), roles: ["SUPER_ADMIN", "MANAGER"] },
  { test: (p) => p.startsWith("/categories"), roles: ["MANAGER"] },
  { test: (p) => p === "/products/new", roles: ["MANAGER"] },
  { test: (p) => /^\/products\/[^/]+\/edit$/.test(p), roles: ["MANAGER"] },
  { test: (p) => p.startsWith("/products"), roles: ["MANAGER", "SELLER"] },
  { test: (p) => p.startsWith("/sales"), roles: ["MANAGER", "SELLER"] },
  { test: (p) => p.startsWith("/users"), roles: ["SUPER_ADMIN", "MANAGER"] },
];

export function isRouteAllowed(pathname: string, role: Role): boolean {
  const rule = ROUTE_ROLE_RULES.find((r) => r.test(pathname));
  if (!rule) return true;
  return rule.roles.includes(role);
}
