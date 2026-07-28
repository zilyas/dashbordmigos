import { formatCurrency } from "@/lib/format";

export function describeActivity(action: string, entity: string, metadata: Record<string, unknown> | null): string {
  const meta = metadata ?? {};
  switch (action) {
    case "product.created":
      return `added product "${meta.name ?? ""}" (${meta.sku ?? ""})`;
    case "product.updated":
      return `updated product "${meta.name ?? ""}" (${meta.sku ?? ""})`;
    case "sale.created":
      return `completed sale ${meta.invoiceNumber ?? ""}${
        typeof meta.total === "number" ? ` — ${formatCurrency(meta.total)}` : ""
      }`;
    case "user.created":
      return `created a ${meta.role ?? "user"} account for ${meta.name ?? ""}`;
    case "manager.created":
      return `created manager account for ${meta.name ?? ""} at ${meta.storeName ?? ""}`;
    case "manager.transferred":
      return `transferred manager ${meta.name ?? ""} to ${meta.storeName ?? ""}`;
    case "manager.updated":
    case "user.updated":
      return `updated ${meta.name ?? "a"} account`;
    case "manager.status_changed":
    case "user.status_changed":
      return `set ${meta.name ?? "an account"} to ${meta.status ?? ""}`.toLowerCase();
    case "manager.deleted":
    case "user.deleted":
      return `deleted account "${meta.name ?? ""}"`;
    case "manager.deactivated":
    case "user.deactivated":
      return `deactivated account "${meta.name ?? ""}" (had dependent records)`;
    case "manager.password_reset":
    case "user.password_reset":
      return `reset the password for "${meta.name ?? ""}"`;
    case "store.created":
      return `created store "${meta.name ?? ""}" (${meta.code ?? ""})`;
    case "store.updated":
      return `updated store "${meta.name ?? ""}"`;
    case "store.status_changed":
      return `set store "${meta.name ?? ""}" to ${meta.status ?? ""}`.toLowerCase();
    case "store.deleted":
      return `deleted store "${meta.name ?? ""}" (${meta.code ?? ""})`;
    case "store.deactivated":
      return `deactivated store "${meta.name ?? ""}" (had dependent records)`;
    case "product.deleted":
      return `deleted product "${meta.name ?? ""}" (${meta.sku ?? ""})`;
    case "product.archived":
      return `archived product "${meta.name ?? ""}" (had dependent records)`;
    case "product.bulk_status_changed":
      return `set ${meta.count ?? 0} product(s) to ${meta.status ?? ""}`.toLowerCase();
    case "settings.updated":
      return `updated store settings for "${meta.storeName ?? ""}"`;
    case "user.login":
      return "signed in";
    case "user.logout":
      return "signed out";
    case "user.password_changed":
      return "changed their password";
    case "user.password_reset_self":
      return "reset their password via email link";
    case "user.session_terminated":
      return "signed out a session";
    case "user.all_sessions_terminated":
      return "signed out of all other sessions";
    case "user.two_factor_enabled":
      return "enabled two-factor authentication";
    case "user.two_factor_disabled":
      return "disabled two-factor authentication";
    case "report.exported":
      return `exported a ${meta.period ?? ""} report`;
    default:
      return `${action.replace(".", " ")} ${entity}`;
  }
}
