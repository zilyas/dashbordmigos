"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { logActivity } from "@/lib/audit";
import {
  saleSchema,
  saleReturnSchema,
  saleDetailsSchema,
  type SaleInput,
  type SaleReturnInput,
  type SaleDetailsInput,
} from "@/lib/validations/sale";

export async function createSale(input: SaleInput) {
  const context = await getSessionContext();
  if (!context || !can(context.role, "sale.create")) {
    return { error: "Not authorized" };
  }
  const storeId = requireStoreId(context);

  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid sale data" };
  const data = parsed.data;

  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) return { error: "Store not found" };

  const productIds = data.items.map((i) => i.productId);
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, storeId } });

  if (products.length !== productIds.length) {
    return { error: "One or more products could not be found" };
  }

  for (const item of data.items) {
    const product = products.find((p) => p.id === item.productId)!;
    if (product.stock < item.quantity) {
      return { error: `Not enough stock for "${product.name}" (${product.stock} available)` };
    }
  }

  let subtotal = 0;
  let itemProfitTotal = 0;
  const itemsData = data.items.map((item) => {
    const product = products.find((p) => p.id === item.productId)!;
    const sellingPrice = Number(product.sellingPrice);
    const fabricationPrice = Number(product.fabricationPrice);
    const profit = (sellingPrice - fabricationPrice) * item.quantity;
    subtotal += sellingPrice * item.quantity;
    itemProfitTotal += profit;
    return {
      productId: product.id,
      quantity: item.quantity,
      sellingPrice,
      fabricationPrice,
      profit,
    };
  });

  const discount = Math.round(subtotal * (data.discountPercent / 100) * 100) / 100;
  const taxable = subtotal - discount;
  const tax = Math.round(taxable * (Number(store.taxRate) / 100) * 100) / 100;
  const total = Math.round((taxable + tax) * 100) / 100;
  const netProfit = Math.round((itemProfitTotal - discount) * 100) / 100;

  try {
    const sale = await prisma.$transaction(async (tx) => {
      const count = await tx.sale.count({ where: { storeId } });
      const invoiceNumber = `INV-${String(count + 1).padStart(6, "0")}`;

      const created = await tx.sale.create({
        data: {
          invoiceNumber,
          sellerId: context.userId,
          customerName: data.customerName || null,
          customerPhone: data.customerPhone || null,
          subtotal,
          discount,
          tax,
          total,
          netProfit,
          paymentMethod: data.paymentMethod,
          storeId,
          items: { create: itemsData },
        },
      });

      for (const item of itemsData) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });

        await tx.inventoryMovement.create({
          data: {
            storeId,
            productId: item.productId,
            type: "OUT",
            quantity: -item.quantity,
            note: `Sold on invoice ${invoiceNumber}`,
            createdById: context.userId,
          },
        });
      }

      await logActivity(
        {
          storeId,
          userId: context.userId,
          action: "sale.created",
          entity: "Sale",
          entityId: created.id,
          metadata: { invoiceNumber, total },
        },
        tx
      );

      return created;
    });

    // Low-stock notifications, best-effort — do not fail the sale if this errors.
    try {
      const updatedProducts = await prisma.product.findMany({
        where: { id: { in: productIds } },
      });
      const lowStock = updatedProducts.filter((p) => p.stock <= p.minimumStock);
      if (lowStock.length > 0) {
        const recipients = await prisma.user.findMany({
          where: { storeId, role: "MANAGER", status: "ACTIVE" },
          select: { id: true },
        });
        await prisma.notification.createMany({
          data: lowStock.flatMap((p) =>
            recipients.map((r) => ({
              storeId,
              userId: r.id,
              type: "LOW_STOCK" as const,
              title: "Low stock alert",
              message: `${p.name} (${p.sku}) is at ${p.stock} units, below the minimum of ${p.minimumStock}.`,
            }))
          ),
        });
      }
    } catch {
      // notifications are non-critical
    }

    revalidatePath("/sales");
    revalidatePath("/products");
    revalidatePath("/dashboard");

    return { success: true as const, saleId: sale.id, invoiceNumber: sale.invoiceNumber };
  } catch {
    return { error: "Failed to complete sale. Please try again." };
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Returns some or all units of a sale back into stock and refunds the
 * customer for them.
 *
 * The sale's stored money columns are rewritten to their post-return values
 * rather than left at the original amounts, because every revenue/profit
 * aggregate in the app reads those columns directly — recalculating here is
 * what keeps the dashboard and report queries correct without any of them
 * having to know that returns exist. The original figures stay recoverable
 * as `total + refundedTotal`, and per-item history as `returnedQuantity`.
 *
 * Discount and tax are refunded proportionally, so a fully returned sale
 * lands exactly at zero instead of leaving rounding residue behind.
 */
export async function returnSaleItems(saleId: string, input: SaleReturnInput) {
  const context = await getSessionContext();
  if (!context || !can(context.role, "sale.refund")) {
    return { error: "Not authorized" };
  }
  const storeId = requireStoreId(context);

  const parsed = saleReturnSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid return data" };
  const data = parsed.data;

  const sale = await prisma.sale.findFirst({
    where: { id: saleId, storeId },
    include: { items: true },
  });
  if (!sale) return { error: "Sale not found" };
  if (sale.status === "REFUNDED") return { error: "This sale has already been fully returned" };

  // Validate every requested line against what is actually still returnable.
  const lines: { item: (typeof sale.items)[number]; quantity: number }[] = [];
  for (const requested of data.items) {
    const item = sale.items.find((i) => i.id === requested.saleItemId);
    if (!item) return { error: "That item is not part of this sale" };
    const remaining = item.quantity - item.returnedQuantity;
    if (requested.quantity > remaining) {
      return {
        error:
          remaining === 0
            ? "Those units have already been returned"
            : `Only ${remaining} unit(s) of that item can still be returned`,
      };
    }
    lines.push({ item, quantity: requested.quantity });
  }

  const originalSubtotal = Number(sale.subtotal);

  // Proportional share of the original discount/tax that these units carried.
  const returnedGross = lines.reduce((sum, l) => sum + Number(l.item.sellingPrice) * l.quantity, 0);
  const shareOfSale = originalSubtotal > 0 ? returnedGross / originalSubtotal : 0;
  const returnedDiscount = round2(Number(sale.discount) * shareOfSale);
  const returnedTax = round2(Number(sale.tax) * shareOfSale);
  const refundAmount = round2(returnedGross - returnedDiscount + returnedTax);
  const returnedProfit = round2(
    lines.reduce(
      (sum, l) => sum + (Number(l.item.sellingPrice) - Number(l.item.fabricationPrice)) * l.quantity,
      0
    ) - returnedDiscount
  );

  // Whether this return closes out every remaining unit on the sale.
  const fullyReturned = sale.items.every((item) => {
    const line = lines.find((l) => l.item.id === item.id);
    return item.quantity - item.returnedQuantity - (line?.quantity ?? 0) === 0;
  });

  try {
    await prisma.$transaction(async (tx) => {
      for (const line of lines) {
        await tx.saleItem.update({
          where: { id: line.item.id },
          data: { returnedQuantity: { increment: line.quantity } },
        });

        await tx.product.update({
          where: { id: line.item.productId },
          data: { stock: { increment: line.quantity } },
        });

        await tx.inventoryMovement.create({
          data: {
            storeId,
            productId: line.item.productId,
            type: "RETURN",
            quantity: line.quantity,
            note: `Returned from invoice ${sale.invoiceNumber}${data.reason ? ` — ${data.reason}` : ""}`,
            createdById: context.userId,
          },
        });
      }

      await tx.sale.update({
        where: { id: sale.id },
        data: {
          subtotal: fullyReturned ? 0 : round2(originalSubtotal - returnedGross),
          discount: fullyReturned ? 0 : round2(Number(sale.discount) - returnedDiscount),
          tax: fullyReturned ? 0 : round2(Number(sale.tax) - returnedTax),
          total: fullyReturned ? 0 : round2(Number(sale.total) - refundAmount),
          netProfit: fullyReturned ? 0 : round2(Number(sale.netProfit) - returnedProfit),
          refundedTotal: round2(Number(sale.refundedTotal) + refundAmount),
          status: fullyReturned ? "REFUNDED" : "PARTIALLY_REFUNDED",
        },
      });

      await logActivity(
        {
          storeId,
          userId: context.userId,
          action: fullyReturned ? "sale.fully_returned" : "sale.partially_returned",
          entity: "Sale",
          entityId: sale.id,
          metadata: {
            invoiceNumber: sale.invoiceNumber,
            refundAmount,
            reason: data.reason || null,
            items: lines.map((l) => ({ productId: l.item.productId, quantity: l.quantity })),
          },
        },
        tx
      );
    });

    revalidatePath("/sales");
    revalidatePath("/products");
    revalidatePath("/dashboard");
    revalidatePath("/reports");

    return { success: true as const, refundAmount, fullyReturned };
  } catch {
    return { error: "Failed to process the return. Please try again." };
  }
}

/** Fixes customer/payment details on a sale. Money and items are untouched. */
export async function updateSaleDetails(saleId: string, input: SaleDetailsInput) {
  const context = await getSessionContext();
  if (!context || !can(context.role, "sale.edit")) {
    return { error: "Not authorized" };
  }
  const storeId = requireStoreId(context);

  const parsed = saleDetailsSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid sale details" };
  const data = parsed.data;

  const sale = await prisma.sale.findFirst({ where: { id: saleId, storeId } });
  if (!sale) return { error: "Sale not found" };

  try {
    await prisma.sale.update({
      where: { id: sale.id },
      data: {
        customerName: data.customerName || null,
        customerPhone: data.customerPhone || null,
        paymentMethod: data.paymentMethod,
      },
    });

    await logActivity({
      storeId,
      userId: context.userId,
      action: "sale.updated",
      entity: "Sale",
      entityId: sale.id,
      metadata: { invoiceNumber: sale.invoiceNumber },
    });

    revalidatePath("/sales");
    return { success: true as const };
  } catch {
    return { error: "Failed to update the sale. Please try again." };
  }
}

/**
 * Removes a sale entirely — for genuine mistakes (wrong item rung up, test
 * entries), not for customer returns. Stock is restored only for units the
 * customer still held; units already given back are skipped, since an earlier
 * return already put those back. SaleItem rows cascade with the sale.
 */
export async function deleteSale(saleId: string) {
  const context = await getSessionContext();
  if (!context || !can(context.role, "sale.delete")) {
    return { error: "Not authorized" };
  }
  const storeId = requireStoreId(context);

  const sale = await prisma.sale.findFirst({
    where: { id: saleId, storeId },
    include: { items: true },
  });
  if (!sale) return { error: "Sale not found" };

  try {
    await prisma.$transaction(async (tx) => {
      for (const item of sale.items) {
        const outstanding = item.quantity - item.returnedQuantity;
        if (outstanding <= 0) continue;

        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: outstanding } },
        });

        await tx.inventoryMovement.create({
          data: {
            storeId,
            productId: item.productId,
            type: "RETURN",
            quantity: outstanding,
            note: `Sale ${sale.invoiceNumber} deleted — stock restored`,
            createdById: context.userId,
          },
        });
      }

      await logActivity(
        {
          storeId,
          userId: context.userId,
          action: "sale.deleted",
          entity: "Sale",
          entityId: sale.id,
          metadata: {
            invoiceNumber: sale.invoiceNumber,
            total: Number(sale.total),
            itemCount: sale.items.length,
          },
        },
        tx
      );

      await tx.sale.delete({ where: { id: sale.id } });
    });

    revalidatePath("/sales");
    revalidatePath("/products");
    revalidatePath("/dashboard");
    revalidatePath("/reports");

    return { success: true as const };
  } catch {
    return { error: "Failed to delete the sale. Please try again." };
  }
}
