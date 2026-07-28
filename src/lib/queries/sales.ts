import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma/enums";

const LIST_CAP = 500;

export async function getPOSProducts(storeId: string) {
  const products = await prisma.product.findMany({
    where: { storeId, status: "ACTIVE" },
    orderBy: { name: "asc" },
    include: { images: { orderBy: { position: "asc" }, take: 1 } },
  });

  return products.map((p) => ({
    id: p.id,
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    size: p.size,
    color: p.color,
    sellingPrice: Number(p.sellingPrice),
    fabricationPrice: Number(p.fabricationPrice),
    stock: p.stock,
    image: p.images[0]?.url ?? null,
  }));
}

export type POSProduct = Awaited<ReturnType<typeof getPOSProducts>>[number];

/**
 * `storeId: null` is only meaningful for SUPER_ADMIN — platform-wide.
 * MANAGER/SELLER always pass their own (non-null) storeId from session.
 */
export async function getSales({
  role,
  userId,
  storeId,
}: {
  role: Role;
  userId: string;
  storeId: string | null;
}) {
  const where = role === "SELLER" ? { sellerId: userId } : storeId ? { storeId } : {};

  const sales = await prisma.sale.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: LIST_CAP,
    include: {
      seller: { select: { name: true } },
      store: { select: { name: true } },
      items: { select: { quantity: true } },
    },
  });

  return sales.map((s) => ({
    id: s.id,
    invoiceNumber: s.invoiceNumber,
    sellerName: s.seller.name,
    storeName: s.store.name,
    customerName: s.customerName,
    itemCount: s.items.reduce((sum, i) => sum + i.quantity, 0),
    subtotal: Number(s.subtotal),
    discount: Number(s.discount),
    tax: Number(s.tax),
    total: Number(s.total),
    netProfit: Number(s.netProfit),
    paymentMethod: s.paymentMethod,
    createdAt: s.createdAt.toISOString(),
  }));
}

export type SaleListItem = Awaited<ReturnType<typeof getSales>>[number];

export async function getSaleReceipt(id: string, storeId: string) {
  const sale = await prisma.sale.findFirst({
    where: { id, storeId },
    include: {
      seller: { select: { name: true } },
      store: true,
      items: { include: { product: { select: { name: true, sku: true } } } },
    },
  });
  if (!sale) return null;

  return {
    id: sale.id,
    invoiceNumber: sale.invoiceNumber,
    sellerName: sale.seller.name,
    customerName: sale.customerName,
    customerPhone: sale.customerPhone,
    subtotal: Number(sale.subtotal),
    discount: Number(sale.discount),
    tax: Number(sale.tax),
    total: Number(sale.total),
    paymentMethod: sale.paymentMethod,
    createdAt: sale.createdAt.toISOString(),
    storeName: sale.store.name,
    currency: sale.store.currency,
    items: sale.items.map((i) => ({
      name: i.product.name,
      sku: i.product.sku,
      quantity: i.quantity,
      sellingPrice: Number(i.sellingPrice),
    })),
  };
}

export type SaleReceipt = Awaited<ReturnType<typeof getSaleReceipt>>;
