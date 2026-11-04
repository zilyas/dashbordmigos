import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { SizesManager } from "@/components/sizes/sizes-manager";
import { getSizes } from "@/lib/queries/sizes";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { getTranslations } from "next-intl/server";
import { toAppLocale } from "@/i18n/messages";

export const metadata: Metadata = { title: "Sizes" };

export default async function SizesPage() {
  const context = await getSessionContext();
  const t = await getTranslations({ locale: toAppLocale(context!.locale), namespace: "catalog.sizes.page" });
  const storeId = requireStoreId(context!);
  const sizes = await getSizes(storeId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      <SizesManager sizes={sizes} />
    </div>
  );
}
