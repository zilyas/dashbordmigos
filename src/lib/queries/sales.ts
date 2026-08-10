import { prisma } from "@/lib/prisma";
import type { PaymentMethod, Role } from "@/generated/prisma/enums";

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
      // Line detail is carried on the list rows so the Manager return dialog
      // can open instantly without a second round-trip per sale.
      items: {
        select: {
          id: true,
          quantity: true,
          returnedQuantity: true,
          sellingPrice: true,
          product: { select: { id: true, name: true, sku: true } },
        },
      },
    },
  });

  return sales.map((s) => ({
    id: s.id,
    invoiceNumber: s.invoiceNumber,
    sellerName: s.seller.name,
    storeName: s.store.name,
    customerName: s.customerName,
    customerPhone: s.customerPhone,
    itemCount: s.items.reduce((sum, i) => sum + i.quantity, 0),
    subtotal: Number(s.subtotal),
    discount: Number(s.discount),
    tax: Number(s.tax),
    total: Number(s.total),
    netProfit: Number(s.netProfit),
    refundedTotal: Number(s.refundedTotal),
    status: s.status,
    paymentMethod: s.paymentMethod,
    createdAt: s.createdAt.toISOString(),
    items: s.items.map((i) => ({
      id: i.id,
      productId: i.product.id,
      productName: i.product.name,
      sku: i.product.sku,
      quantity: i.quantity,
      returnedQuantity: i.returnedQuantity,
      sellingPrice: Number(i.sellingPrice),
    })),
  }));
}

export type SaleListItem = Awaited<ReturnType<typeof getSales>>[number];

/** Shape the POS terminal builds client-side after a successful sale — not fetched from the DB. */
export type SaleReceipt = {
  id: string;
  invoiceNumber: string;
  sellerName: string;
  customerName: string | null;
  customerPhone: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paymentMethod: PaymentMethod;
  createdAt: string;
  storeName: string;
  currency: string;
  items: { name: string; sku: string; quantity: number; sellingPrice: number }[];
} | null;
