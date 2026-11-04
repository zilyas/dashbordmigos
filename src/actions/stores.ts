"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac-guards";
import { logActivity } from "@/lib/audit";
import { buildStoreSchema, type StoreInput } from "@/lib/validations/store";
import { toAppLocale } from "@/i18n/messages";
import { Prisma } from "@/generated/prisma/client";
import { isForeignKeyConstraintError } from "@/lib/prisma-errors";
import type { StoreStatus } from "@/generated/prisma/enums";

const requireStoreManager = requirePermission("store.manage");
const requireStoreReset = requirePermission("store.reset");

// Typed by the operator to confirm an irreversible store reset. Kept in sync
// with the same constant in the reset dialog — this module is "use server",
// so it can only export async functions, not shared constants.
const RESET_CONFIRMATION_TEXT = "RESET";

export async function createStore(input: StoreInput) {
  const session = await requireStoreManager();
  const locale = toAppLocale(session.locale);
  const tValidation = await getTranslations({ locale, namespace: "validation" });
  const t = await getTranslations({ locale, namespace: "people.actions" });
  const parsed = buildStoreSchema(tValidation).safeParse(input);
  if (!parsed.success) return { error: t("invalidStoreData") };
  const data = parsed.data;

  try {
    const store = await prisma.store.create({
      data: {
        name: data.name,
        code: data.code.toUpperCase(),
        currency: data.currency.toUpperCase(),
        taxRate: data.taxRate,
        address: data.address || null,
        city: data.city || null,
        country: data.country || null,
        phone: data.phone || null,
        email: data.email || null,
        logo: data.logo || null,
        ...(data.features ? { features: data.features } : {}),
      },
    });

    await logActivity({
      storeId: store.id,
      userId: session.user.id,
      action: "store.created",
      entity: "Store",
      entityId: store.id,
      metadata: { name: store.name, code: store.code },
    });

    const otherAdmins = await prisma.user.findMany({
      where: { role: "SUPER_ADMIN", status: "ACTIVE", id: { not: session.user.id } },
      select: { id: true },
    });
    if (otherAdmins.length > 0) {
      await prisma.notification.createMany({
        data: otherAdmins.map((admin) => ({
          storeId: store.id,
          userId: admin.id,
          type: "STORE_CREATED" as const,
          title: t("newStoreNotificationTitle"),
          message: t("newStoreNotificationMessage", { name: store.name, code: store.code }),
        })),
      });
    }

    revalidatePath("/stores");
    return { success: true as const, id: store.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: t("storeCodeExists") };
    }
    throw error;
  }
}

export async function updateStore(id: string, input: StoreInput) {
  const session = await requireStoreManager();
  const locale = toAppLocale(session.locale);
  const tValidation = await getTranslations({ locale, namespace: "validation" });
  const t = await getTranslations({ locale, namespace: "people.actions" });
  const parsed = buildStoreSchema(tValidation).safeParse(input);
  if (!parsed.success) return { error: t("invalidStoreData") };
  const data = parsed.data;

  try {
    await prisma.store.update({
      where: { id },
      data: {
        name: data.name,
        code: data.code.toUpperCase(),
        currency: data.currency.toUpperCase(),
        taxRate: data.taxRate,
        address: data.address || null,
        city: data.city || null,
        country: data.country || null,
        phone: data.phone || null,
        email: data.email || null,
        logo: data.logo || null,
        ...(data.features ? { features: data.features } : {}),
      },
    });

    await logActivity({
      storeId: id,
      userId: session.user.id,
      action: "store.updated",
      entity: "Store",
      entityId: id,
      metadata: { name: data.name },
    });

    revalidatePath("/stores");
    revalidatePath(`/stores/${id}`);
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: t("storeCodeExists") };
    }
    throw error;
  }
}

export async function toggleStoreStatus(id: string) {
  const session = await requireStoreManager();
  const t = await getTranslations({ locale: toAppLocale(session.locale), namespace: "people.actions" });
  const store = await prisma.store.findUnique({ where: { id } });
  if (!store) return { error: t("storeNotFound") };

  const nextStatus: StoreStatus = store.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
  await prisma.store.update({ where: { id }, data: { status: nextStatus } });

  await logActivity({
    storeId: id,
    userId: session.user.id,
    action: "store.status_changed",
    entity: "Store",
    entityId: id,
    metadata: { name: store.name, status: nextStatus },
  });

  revalidatePath("/stores");
  revalidatePath(`/stores/${id}`);
  return { success: true as const, status: nextStatus };
}

export async function deleteStore(id: string) {
  const session = await requireStoreManager();
  const t = await getTranslations({ locale: toAppLocale(session.locale), namespace: "people.actions" });
  const store = await prisma.store.findUnique({ where: { id } });
  if (!store) return { error: t("storeNotFound") };

  try {
    await prisma.store.delete({ where: { id } });

    await logActivity({
      storeId: null,
      userId: session.user.id,
      action: "store.deleted",
      entity: "Store",
      entityId: id,
      metadata: { name: store.name, code: store.code },
    });

    revalidatePath("/stores");
    return { success: true as const, deactivated: false };
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      await prisma.store.update({ where: { id }, data: { status: "INACTIVE" } });

      await logActivity({
        storeId: id,
        userId: session.user.id,
        action: "store.deactivated",
        entity: "Store",
        entityId: id,
        metadata: { name: store.name, reason: "has dependent records" },
      });

      revalidatePath("/stores");
      return { success: true as const, deactivated: true };
    }
    throw error;
  }
}

/**
 * Wipes a store's trading history — sales, sale items, inventory movements
 * and expenses — while leaving the catalogue (products, categories), staff
 * and settings intact, so the store keeps its setup but starts fresh
 * financially.
 *
 * Product stock levels are deliberately NOT rewound to pre-sale values:
 * current stock reflects physical reality on the shelf, and the sales that
 * moved it are exactly what is being erased. Stock stays as-is and can be
 * corrected afterwards via inventory adjustment if needed.
 */
export async function resetStoreData(storeId: string, confirmText: string) {
  const session = await requireStoreReset();
  const t = await getTranslations({ locale: toAppLocale(session.locale), namespace: "people.actions" });

  if (confirmText !== RESET_CONFIRMATION_TEXT) {
    return { error: t("resetConfirmationMismatch", { confirmText: RESET_CONFIRMATION_TEXT }) };
  }

  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) return { error: t("storeNotFound") };

  try {
    const result = await prisma.$transaction(async (tx) => {
      // SaleItem rows cascade from Sale, so they need no explicit delete.
      const [sales, movements, expenses] = await Promise.all([
        tx.sale.deleteMany({ where: { storeId } }),
        tx.inventoryMovement.deleteMany({ where: { storeId } }),
        tx.expense.deleteMany({ where: { storeId } }),
      ]);

      await logActivity(
        {
          storeId,
          userId: session.user.id,
          action: "store.data_reset",
          entity: "Store",
          entityId: storeId,
          metadata: {
            name: store.name,
            salesDeleted: sales.count,
            movementsDeleted: movements.count,
            expensesDeleted: expenses.count,
          },
        },
        tx
      );

      return { sales: sales.count, movements: movements.count, expenses: expenses.count };
    });

    revalidatePath("/stores");
    revalidatePath(`/stores/${storeId}`);
    revalidatePath("/dashboard");
    revalidatePath("/reports");

    return { success: true as const, ...result };
  } catch {
    return { error: t("resetFailed") };
  }
}
