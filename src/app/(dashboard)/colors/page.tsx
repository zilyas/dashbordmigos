import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { ColorsManager } from "@/components/colors/colors-manager";
import { getColors } from "@/lib/queries/colors";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { getTranslations } from "next-intl/server";
import { toAppLocale } from "@/i18n/messages";

export const metadata: Metadata = { title: "Colors" };

export default async function ColorsPage() {
  const context = await getSessionContext();
  const t = await getTranslations({ locale: toAppLocale(context!.locale), namespace: "catalog.colors.page" });
  const storeId = requireStoreId(context!);
  const colors = await getColors(storeId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      <ColorsManager colors={colors} />
    </div>
  );
}
