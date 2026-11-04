import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { VariantAxesManager } from "@/components/variant-axes/variant-axes-manager";
import { getVariantAxes } from "@/lib/queries/variant-axes";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { getStoreFeatures } from "@/lib/features";
import { getTranslations } from "next-intl/server";
import { toAppLocale } from "@/i18n/messages";

export const metadata: Metadata = { title: "Variant Axes" };

export default async function VariantAxesPage() {
  const context = await getSessionContext();
  const t = await getTranslations({ locale: toAppLocale(context!.locale), namespace: "catalog.variantAxes.page" });
  const storeId = requireStoreId(context!);

  // The screen only exists when the store enabled custom variant axes.
  const features = await getStoreFeatures(storeId);
  if (!features.custom_variant_axes_enabled) redirect("/products");

  const axes = await getVariantAxes(storeId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
      />
      <VariantAxesManager axes={axes} />
    </div>
  );
}
