import { prisma } from "@/lib/prisma";
import { parseOptions, type AttributeType } from "@/lib/attributes";

/** True when a category's metadata opts it into clothing variant support. */
function isClothingMetadata(metadata: unknown): boolean {
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>).clothing === true
  );
}

export type CategoryAttribute = {
  id: string;
  key: string;
  label: string;
  type: AttributeType;
  options: string[];
  required: boolean;
  position: number;
};

export async function getCategories(storeId: string) {
  const categories = await prisma.category.findMany({
    where: { storeId },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { products: true } },
      parent: { select: { id: true, name: true } },
      attributeDefinitions: { orderBy: [{ position: "asc" }, { label: "asc" }] },
    },
  });

  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    isActive: c.isActive,
    parentId: c.parentId,
    parentName: c.parent?.name ?? null,
    isClothing: isClothingMetadata(c.metadata),
    productCount: c._count.products,
    // Phase 2: per-category attribute definitions (empty unless configured).
    attributes: c.attributeDefinitions.map((d): CategoryAttribute => ({
      id: d.id,
      key: d.key,
      label: d.label,
      type: d.type,
      options: parseOptions(d.options),
      required: d.required,
      position: d.position,
    })),
    createdAt: c.createdAt.toISOString(),
  }));
}

export type CategoryListItem = Awaited<ReturnType<typeof getCategories>>[number];
