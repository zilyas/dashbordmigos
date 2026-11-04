import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { ApiClientsManager } from "@/components/integrations/api-clients-manager";
import { IntegrationGuide } from "@/components/integrations/integration-guide";
import { getApiClients } from "@/lib/queries/api-clients";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { getStoreFeatures } from "@/lib/features";
import { toAppLocale } from "@/i18n/messages";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = { title: "Storefront API" };

export default async function IntegrationsPage() {
  const context = await getSessionContext();
  const storeId = requireStoreId(context!);
  const t = await getTranslations({ locale: toAppLocale(context!.locale), namespace: "integrations.page" });

  // The screen only exists when the store enabled the storefront API.
  const features = await getStoreFeatures(storeId);
  if (!features.storefront_api_enabled) redirect("/dashboard");

  const clients = await getApiClients(storeId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
      />
      <ApiClientsManager clients={clients} />
      <IntegrationGuide locale={toAppLocale(context!.locale)} />
    </div>
  );
}
