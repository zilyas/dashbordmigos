import { formatCurrency } from "@/lib/format";
import { roleLabel, userStatusLabel, storeStatusLabel, productStatusLabel } from "@/lib/labels";
import type { Role, UserStatus, StoreStatus, ProductStatus } from "@/generated/prisma/enums";

type ActivityT = (key: string, values?: Record<string, string | number>) => string;
type LabelsT = (key: string) => string;

/**
 * Builds the human-readable activity-log sentence. Takes both translators
 * (resolved via `useTranslations("activity")` / `useTranslations("labels")`
 * in the caller) so the DB enum values embedded in `metadata` (role, status)
 * render as their translated label, not the raw enum string.
 */
export function describeActivity(
  t: ActivityT,
  tLabels: LabelsT,
  action: string,
  entity: string,
  metadata: Record<string, unknown> | null
): string {
  const meta = metadata ?? {};
  const name = typeof meta.name === "string" ? meta.name : "";
  const sku = typeof meta.sku === "string" ? meta.sku : "";
  const code = typeof meta.code === "string" ? meta.code : "";
  const storeName = typeof meta.storeName === "string" ? meta.storeName : "";
  const invoiceNumber = typeof meta.invoiceNumber === "string" ? meta.invoiceNumber : "";
  const count = typeof meta.count === "number" ? meta.count : 0;
  const period = typeof meta.period === "string" ? meta.period : "";

  switch (action) {
    case "product.created":
      return t("describe.productCreated", { name, sku });
    case "product.updated":
      return t("describe.productUpdated", { name, sku });
    case "sale.created":
      return typeof meta.total === "number"
        ? t("describe.saleCreatedWithTotal", { invoiceNumber, total: formatCurrency(meta.total) })
        : t("describe.saleCreated", { invoiceNumber });
    case "user.created":
      return t("describe.userCreated", { name, role: roleLabel(tLabels, (meta.role as Role) ?? "SELLER") });
    case "manager.created":
      return t("describe.managerCreated", { name, storeName });
    case "manager.transferred":
      return t("describe.managerTransferred", { name, storeName });
    case "manager.updated":
    case "user.updated":
      return t("describe.accountUpdated", { name: name || "—" });
    case "manager.status_changed":
    case "user.status_changed":
      return t("describe.accountStatusChanged", {
        name: name || "",
        status: userStatusLabel(tLabels, (meta.status as UserStatus) ?? "ACTIVE"),
      });
    case "manager.deleted":
    case "user.deleted":
      return t("describe.accountDeleted", { name });
    case "manager.deactivated":
    case "user.deactivated":
      return t("describe.accountDeactivated", { name });
    case "manager.password_reset":
    case "user.password_reset":
      return t("describe.passwordReset", { name });
    case "store.created":
      return t("describe.storeCreated", { name, code });
    case "store.updated":
      return t("describe.storeUpdated", { name });
    case "store.status_changed":
      return t("describe.storeStatusChanged", {
        name,
        status: storeStatusLabel(tLabels, (meta.status as StoreStatus) ?? "ACTIVE"),
      });
    case "store.deleted":
      return t("describe.storeDeleted", { name, code });
    case "store.deactivated":
      return t("describe.storeDeactivated", { name });
    case "product.deleted":
      return t("describe.productDeleted", { name, sku });
    case "product.archived":
      return t("describe.productArchived", { name });
    case "product.bulk_status_changed":
      return t("describe.productBulkStatusChanged", {
        count,
        status: productStatusLabel(tLabels, (meta.status as ProductStatus) ?? "ACTIVE"),
      });
    case "settings.updated":
      return t("describe.settingsUpdated", { storeName });
    case "user.login":
      return t("describe.userLogin");
    case "user.logout":
      return t("describe.userLogout");
    case "user.password_changed":
      return t("describe.passwordChanged");
    case "user.password_reset_self":
      return t("describe.passwordResetSelf");
    case "user.session_terminated":
      return t("describe.sessionTerminated");
    case "user.all_sessions_terminated":
      return t("describe.allSessionsTerminated");
    case "user.two_factor_enabled":
      return t("describe.twoFactorEnabled");
    case "user.two_factor_disabled":
      return t("describe.twoFactorDisabled");
    case "report.exported":
      return t("describe.reportExported", { period });
    default:
      return t("describe.fallback", { action: action.replace(".", " "), entity });
  }
}
