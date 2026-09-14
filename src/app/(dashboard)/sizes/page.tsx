import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { SizesManager } from "@/components/sizes/sizes-manager";
import { getSizes } from "@/lib/queries/sizes";
import { getSessionContext, requireStoreId } from "@/lib/store-context";

export const metadata: Metadata = { title: "Sizes" };

export default async function SizesPage() {
  const context = await getSessionContext();
  const storeId = requireStoreId(context!);
  const sizes = await getSizes(storeId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Sizes" description="Store-wide sizes for clothing product variants." />
      <SizesManager sizes={sizes} />
    </div>
  );
}
