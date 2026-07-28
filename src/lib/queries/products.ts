import { prisma } from "@/lib/prisma";

const LIST_CAP = 500;

export async function getProducts(storeId: string) {
  const products = await prisma.product.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take: LIST_CAP,
    include: {
      category: { select: { id: true, name: true } },
      images: { orderBy: { position: "asc" }, take: 1 },
    },
  });

  return products.map((p) => ({
    id: p.id,
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    categoryId: p.categoryId,
    categoryName: p.category?.name ?? null,
    type: p.type,
    size: p.size,
    color: p.color,
    fabricationPrice: Number(p.fabricationPrice),
    sellingPrice: Number(p.sellingPrice),
    profitMargin: Number(p.profitMargin),
    stock: p.stock,
    minimumStock: p.minimumStock,
    status: p.status,
    image: p.images[0]?.url ?? null,
    createdAt: p.createdAt.toISOString(),
  }));
}

export type ProductListItem = Awaited<ReturnType<typeof getProducts>>[number];

export async function getProductById(id: string, storeId: string) {
  const product = await prisma.product.findFirst({
    where: { id, storeId },
    include: { images: { orderBy: { position: "asc" } } },
  });
  if (!product) return null;

  return {
    id: product.id,
    sku: product.sku,
    barcode: product.barcode ?? "",
    name: product.name,
    description: product.description ?? "",
    categoryId: product.categoryId ?? "",
    type: product.type ?? "",
    size: product.size ?? "",
    color: product.color ?? "",
    fabricationPrice: Number(product.fabricationPrice),
    sellingPrice: Number(product.sellingPrice),
    stock: product.stock,
    minimumStock: product.minimumStock,
    status: product.status,
    images: product.images.map((i) => i.url),
  };
}
