import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { ColorsManager } from "@/components/colors/colors-manager";
import { getColors } from "@/lib/queries/colors";
import { getSessionContext, requireStoreId } from "@/lib/store-context";

export const metadata: Metadata = { title: "Colors" };

export default async function ColorsPage() {
  const context = await getSessionContext();
  const storeId = requireStoreId(context!);
  const colors = await getColors(storeId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Colors" description="Store-wide colors for clothing product variants." />
      <ColorsManager colors={colors} />
    </div>
  );
}
