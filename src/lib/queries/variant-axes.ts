import { prisma } from "@/lib/prisma";

export async function getVariantAxes(storeId: string) {
  const axes = await prisma.variantAxisDefinition.findMany({
    where: { storeId },
    orderBy: [{ position: "asc" }, { label: "asc" }],
  });

  return axes.map((a) => ({
    id: a.id,
    key: a.key,
    label: a.label,
    position: a.position,
    isActive: a.isActive,
  }));
}

export type VariantAxisItem = Awaited<ReturnType<typeof getVariantAxes>>[number];
