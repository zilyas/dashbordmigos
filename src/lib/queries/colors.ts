import { prisma } from "@/lib/prisma";

export async function getColors(storeId: string) {
  const colors = await prisma.color.findMany({
    where: { storeId },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    include: { _count: { select: { variants: true } } },
  });

  return colors.map((c) => ({
    id: c.id,
    name: c.name,
    hex: c.hex,
    position: c.position,
    variantCount: c._count.variants,
  }));
}

export type ColorListItem = Awaited<ReturnType<typeof getColors>>[number];
