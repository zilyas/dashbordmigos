import { prisma } from "@/lib/prisma";

export async function getSizes(storeId: string) {
  const sizes = await prisma.size.findMany({
    where: { storeId },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    include: { _count: { select: { variants: true } } },
  });

  return sizes.map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position,
    variantCount: s._count.variants,
  }));
}

export type SizeListItem = Awaited<ReturnType<typeof getSizes>>[number];
