import { prisma } from "@/lib/prisma";
import type { ProductUnit } from "@/lib/validations/product";
import { parseAxisValues } from "@/lib/variant-axes";

const LIST_CAP = 500;

export async function getProducts(storeId: string) {
  const products = await prisma.product.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take: LIST_CAP,
    include: {
      category: { select: { id: true, name: true } },
      images: { orderBy: { position: "asc" }, take: 1 },
      _count: { select: { variants: true } },
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
    hasVariants: p.hasVariants,
    variantCount: p._count.variants,
    unit: (p.unit ?? "piece") as ProductUnit,
    fabricationPrice: Number(p.fabricationPrice),
    sellingPrice: Number(p.sellingPrice),
    profitMargin: Number(p.profitMargin),
    stock: Number(p.stock),
    minimumStock: Number(p.minimumStock),
    status: p.status,
    image: p.images[0]?.url ?? null,
    createdAt: p.createdAt.toISOString(),
  }));
}

export type ProductListItem = Awaited<ReturnType<typeof getProducts>>[number];

export async function getProductById(id: string, storeId: string) {
  const product = await prisma.product.findFirst({
    where: { id, storeId },
    include: {
      images: { orderBy: { position: "asc" } },
      attributeValues: { select: { definitionId: true, value: true } },
    },
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
    hasVariants: product.hasVariants,
    trackBatch: product.trackBatch,
    unit: (product.unit ?? "piece") as ProductUnit,
    allowDecimalQuantity: product.allowDecimalQuantity,
    fabricationPrice: Number(product.fabricationPrice),
    sellingPrice: Number(product.sellingPrice),
    stock: Number(product.stock),
    minimumStock: Number(product.minimumStock),
    status: product.status,
    images: product.images.map((i) => i.url),
    // Phase 2: existing attribute values keyed by definition id.
    attributes: product.attributeValues.map((v) => ({
      definitionId: v.definitionId,
      value: v.value,
    })),
  };
}

/** Variant rows for the product edit page's variant-management section. */
export async function getProductVariants(productId: string, storeId: string) {
  const variants = await prisma.productVariant.findMany({
    where: { productId, storeId },
    orderBy: { createdAt: "asc" },
    include: {
      size: { select: { id: true, name: true } },
      color: { select: { id: true, name: true } },
    },
  });

  return variants.map((v) => ({
    id: v.id,
    sizeId: v.sizeId,
    sizeName: v.size?.name ?? null,
    colorId: v.colorId,
    colorName: v.color?.name ?? null,
    sku: v.sku,
    barcode: v.barcode ?? "",
    sellingPrice: v.sellingPrice != null ? Number(v.sellingPrice) : null,
    fabricationPrice: v.fabricationPrice != null ? Number(v.fabricationPrice) : null,
    stock: Number(v.stock),
    isActive: v.isActive,
    imageUrl: v.imageUrl ?? "",
    axisValues: parseAxisValues(v.axisValues),
  }));
}

export type ProductVariantItem = Awaited<ReturnType<typeof getProductVariants>>[number];
