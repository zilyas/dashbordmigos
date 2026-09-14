import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { StoreSettingsForm } from "@/components/settings/store-settings-form";
import { ThemeSettings } from "@/components/settings/theme-settings";
import { StarterCatalogCard } from "@/components/settings/starter-catalog-card";
import { getStoreSettings } from "@/lib/queries/settings";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const context = await getSessionContext();
  const storeId = requireStoreId(context!);
  const [settings, categoryCount] = await Promise.all([
    getStoreSettings(storeId),
    prisma.category.count({ where: { storeId } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="Store configuration and preferences." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <StoreSettingsForm settings={settings} />
        <ThemeSettings />
      </div>
      <StarterCatalogCard features={settings.features} catalogConfigured={categoryCount > 0} />
    </div>
  );
}
