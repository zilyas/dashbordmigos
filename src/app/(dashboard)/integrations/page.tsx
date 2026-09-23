import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { ApiClientsManager } from "@/components/integrations/api-clients-manager";
import { IntegrationGuide } from "@/components/integrations/integration-guide";
import { getApiClients } from "@/lib/queries/api-clients";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { getStoreFeatures } from "@/lib/features";

export const metadata: Metadata = { title: "Storefront API" };

export default async function IntegrationsPage() {
  const context = await getSessionContext();
  const storeId = requireStoreId(context!);

  // The screen only exists when the store enabled the storefront API.
  const features = await getStoreFeatures(storeId);
  if (!features.storefront_api_enabled) redirect("/dashboard");

  const clients = await getApiClients(storeId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Storefront API"
        description="Connect an e-commerce website to this shop's catalogue, stock and orders."
      />
      <ApiClientsManager clients={clients} />
      <IntegrationGuide />
    </div>
  );
}
