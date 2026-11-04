// Phase 2: English + French, both bundled statically.
//
// These MUST stay literal `import` statements, never `import()`. A dynamic
// import can get code-split into its own chunk, and /offline/pos's service
// worker precache (public/sw.js) only scrapes /_next/static asset paths out
// of the one HTML page it caches -- it has no way to discover or fetch a
// chunk that isn't already part of that page's JS graph. A literal import
// inlines ALL of this JSON directly into the same bundle as
// offline-pos-client.tsx / pos-terminal.tsx, so switching locale -- online or
// offline -- never costs a network request: both languages are already on
// the device.
import enCommon from "../../messages/en/common.json";
import enNav from "../../messages/en/nav.json";
import enProducts from "../../messages/en/products.json";
import enSalesPos from "../../messages/en/sales-pos.json";
import enOfflinePos from "../../messages/en/offline-pos.json";
import enReceipt from "../../messages/en/receipt.json";
import enLabels from "../../messages/en/labels.json";
import enCommandPalette from "../../messages/en/command-palette.json";
import enTopbar from "../../messages/en/topbar.json";
import enValidation from "../../messages/en/validation.json";
import enReports from "../../messages/en/reports.json";
import enCatalog from "../../messages/en/catalog.json";
import enBatches from "../../messages/en/batches.json";
import enDashboard from "../../messages/en/dashboard.json";
import enActivity from "../../messages/en/activity.json";
import enSalesList from "../../messages/en/sales-list.json";
import enAccount from "../../messages/en/account.json";
import enSettings from "../../messages/en/settings.json";
import enPeople from "../../messages/en/people.json";
import enStoreDetail from "../../messages/en/store-detail.json";
import enSecurity from "../../messages/en/security.json";
import enBackups from "../../messages/en/backups.json";
import enIntegrations from "../../messages/en/integrations.json";
import enMessaging from "../../messages/en/messaging.json";
import enAnnouncements from "../../messages/en/announcements.json";
import enNotifications from "../../messages/en/notifications.json";
import frCommon from "../../messages/fr/common.json";
import frNav from "../../messages/fr/nav.json";
import frProducts from "../../messages/fr/products.json";
import frSalesPos from "../../messages/fr/sales-pos.json";
import frOfflinePos from "../../messages/fr/offline-pos.json";
import frReceipt from "../../messages/fr/receipt.json";
import frLabels from "../../messages/fr/labels.json";
import frCommandPalette from "../../messages/fr/command-palette.json";
import frTopbar from "../../messages/fr/topbar.json";
import frValidation from "../../messages/fr/validation.json";
import frReports from "../../messages/fr/reports.json";
import frCatalog from "../../messages/fr/catalog.json";
import frBatches from "../../messages/fr/batches.json";
import frDashboard from "../../messages/fr/dashboard.json";
import frActivity from "../../messages/fr/activity.json";
import frSalesList from "../../messages/fr/sales-list.json";
import frAccount from "../../messages/fr/account.json";
import frSettings from "../../messages/fr/settings.json";
import frPeople from "../../messages/fr/people.json";
import frStoreDetail from "../../messages/fr/store-detail.json";
import frSecurity from "../../messages/fr/security.json";
import frBackups from "../../messages/fr/backups.json";
import frIntegrations from "../../messages/fr/integrations.json";
import frMessaging from "../../messages/fr/messaging.json";
import frAnnouncements from "../../messages/fr/announcements.json";
import frNotifications from "../../messages/fr/notifications.json";

export const messagesByLocale = {
  en: {
    common: enCommon,
    nav: enNav,
    products: enProducts,
    sales: { pos: enSalesPos, list: enSalesList },
    offline: { pos: enOfflinePos },
    receipt: enReceipt,
    labels: enLabels,
    commandPalette: enCommandPalette,
    topbar: enTopbar,
    validation: enValidation,
    reports: enReports,
    catalog: enCatalog,
    batches: enBatches,
    dashboard: enDashboard,
    activity: enActivity,
    account: enAccount,
    settings: enSettings,
    people: enPeople,
    storeDetail: enStoreDetail,
    security: enSecurity,
    backups: enBackups,
    integrations: enIntegrations,
    messaging: enMessaging,
    announcements: enAnnouncements,
    notifications: enNotifications,
  },
  fr: {
    common: frCommon,
    nav: frNav,
    products: frProducts,
    sales: { pos: frSalesPos, list: frSalesList },
    offline: { pos: frOfflinePos },
    receipt: frReceipt,
    labels: frLabels,
    commandPalette: frCommandPalette,
    topbar: frTopbar,
    validation: frValidation,
    reports: frReports,
    catalog: frCatalog,
    batches: frBatches,
    dashboard: frDashboard,
    activity: frActivity,
    account: frAccount,
    settings: frSettings,
    people: frPeople,
    storeDetail: frStoreDetail,
    security: frSecurity,
    backups: frBackups,
    integrations: frIntegrations,
    messaging: frMessaging,
    announcements: frAnnouncements,
    notifications: frNotifications,
  },
} as const;

export type AppLocale = keyof typeof messagesByLocale;

/** Root layout's provider (src/app/layout.tsx) stays on this locale forever -- see src/i18n/request.ts. */
export const DEFAULT_LOCALE: AppLocale = "en";

/**
 * Maps the Prisma `Locale` enum (`"EN" | "FR"`, stored on `User.locale`) to
 * the lowercase string next-intl expects. Falls back to `DEFAULT_LOCALE` for
 * anything unrecognized -- a till reading an older/corrupt cached value, or a
 * schema value this mapping hasn't caught up with -- rather than throwing.
 */
export function toAppLocale(value: string | null | undefined): AppLocale {
  const lower = value?.toLowerCase();
  return lower === "fr" ? "fr" : DEFAULT_LOCALE;
}
