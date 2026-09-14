import { prisma } from "@/lib/prisma";
import type { PaymentMethod, Role } from "@/generated/prisma/enums";
import { parseAxisValues, axisValueList } from "@/lib/variant-axes";
import { variantLabelFromParts } from "@/lib/sale-math";

const LIST_CAP = 500;

export async function getPOSProducts(storeId: string) {
  const [products, axisDefs] = await Promise.all([
    prisma.product.findMany({
      where: { storeId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      include: {
        images: { orderBy: { position: "asc" }, take: 1 },
        variants: {
          where: { isActive: true },
          orderBy: { createdAt: "asc" },
          include: {
            size: { select: { name: true } },
            color: { select: { name: true } },
          },
        },
      },
    }),
    prisma.variantAxisDefinition.findMany({
      where: { storeId, isActive: true },
      orderBy: [{ position: "asc" }, { label: "asc" }],
      select: { key: true, label: true },
    }),
  ]);

  return products.map((p) => {
    const basePrice = Number(p.sellingPrice);
    const baseCost = Number(p.fabricationPrice);
    return {
      id: p.id,
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      size: p.size,
      color: p.color,
      unit: p.unit ?? "piece",
      allowDecimalQuantity: p.allowDecimalQuantity,
      sellingPrice: basePrice,
      fabricationPrice: baseCost,
      // For variant products, base stock is not sold directly; the POS uses the
      // per-variant stock below. Reported as the sum so the card still shows
      // availability at a glance.
      stock: p.hasVariants ? p.variants.reduce((s, v) => s + Number(v.stock), 0) : Number(p.stock),
      image: p.images[0]?.url ?? null,
      hasVariants: p.hasVariants,
      variants: p.variants.map((v) => ({
        id: v.id,
        label:
          variantLabelFromParts([
            v.size?.name,
            v.color?.name,
            ...axisValueList(parseAxisValues(v.axisValues), axisDefs),
          ]) || v.sku,
        sku: v.sku,
        sellingPrice: v.sellingPrice != null ? Number(v.sellingPrice) : basePrice,
        stock: Number(v.stock),
        imageUrl: v.imageUrl,
      })),
    };
  });
}

export type POSProduct = Awaited<ReturnType<typeof getPOSProducts>>[number];
export type POSVariant = POSProduct["variants"][number];

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
          variantLabel: true,
          product: {
            select: { id: true, name: true, sku: true, unit: true, allowDecimalQuantity: true },
          },
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
    itemCount: s.items.reduce((sum, i) => sum + Number(i.quantity), 0),
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
      variantLabel: i.variantLabel,
      quantity: Number(i.quantity),
      returnedQuantity: Number(i.returnedQuantity),
      sellingPrice: Number(i.sellingPrice),
      unit: i.product.unit ?? "piece",
      allowDecimalQuantity: i.product.allowDecimalQuantity,
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
