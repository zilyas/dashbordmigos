import { prisma } from "@/lib/prisma";

export async function getCategories(storeId: string) {
  const categories = await prisma.category.findMany({
    where: { storeId },
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true } } },
  });

  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    productCount: c._count.products,
    createdAt: c.createdAt.toISOString(),
  }));
}

export type CategoryListItem = Awaited<ReturnType<typeof getCategories>>[number];
