"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { logActivity } from "@/lib/audit";
import { saleSchema, type SaleInput } from "@/lib/validations/sale";

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
