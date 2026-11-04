"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireStorePermission } from "@/lib/rbac-guards";
import { generateTempPassword, hashPassword } from "@/lib/security/password";
import { logActivity } from "@/lib/audit";
import {
  buildCreateSellerSchema,
  buildUpdateSellerSchema,
  type CreateSellerInput,
  type UpdateSellerInput,
} from "@/lib/validations/user";
import { toAppLocale } from "@/i18n/messages";
import { Prisma } from "@/generated/prisma/client";
import { isForeignKeyConstraintError } from "@/lib/prisma-errors";

const requireSellerManager = requireStorePermission("seller.manage");

/** Verifies a target Seller belongs to the acting Manager's store before any mutation. */
async function requireOwnedSeller(id: string, storeId: string) {
  const seller = await prisma.user.findFirst({ where: { id, role: "SELLER", storeId } });
  return seller;
}

export async function createSeller(input: CreateSellerInput) {
  const session = await requireSellerManager();
  const locale = toAppLocale(session.locale);
  const tValidation = await getTranslations({ locale, namespace: "validation" });
  const t = await getTranslations({ locale, namespace: "people.actions" });
  const parsed = buildCreateSellerSchema(tValidation).safeParse(input);
  if (!parsed.success) return { error: t("invalidSellerData") };
  const data = parsed.data;

  try {
    const passwordHash = await hashPassword(data.password);
    const seller = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash,
        role: "SELLER",
        storeId: session.storeId,
        createdById: session.userId,
        phone: data.phone || null,
      },
    });

    await logActivity({
      storeId: session.storeId,
      userId: session.userId,
      action: "user.created",
      entity: "User",
      entityId: seller.id,
      metadata: { name: seller.name, role: seller.role },
    });

    await prisma.notification.create({
      data: {
        storeId: session.storeId,
        userId: seller.id,
        type: "SELLER_ADDED",
        title: t("welcomeNotificationTitle"),
        message: t("welcomeNotificationMessage"),
      },
    });

    revalidatePath("/users");
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: t("sellerEmailExists") };
    }
    throw error;
  }
}

export async function updateSeller(id: string, input: UpdateSellerInput) {
  const session = await requireSellerManager();
  const locale = toAppLocale(session.locale);
  const tValidation = await getTranslations({ locale, namespace: "validation" });
  const t = await getTranslations({ locale, namespace: "people.actions" });
  const parsed = buildUpdateSellerSchema(tValidation).safeParse(input);
  if (!parsed.success) return { error: t("invalidSellerData") };
  const data = parsed.data;

  const seller = await requireOwnedSeller(id, session.storeId);
  if (!seller) return { error: t("sellerNotFound") };

  try {
    await prisma.user.update({
      where: { id },
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone || null,
      },
    });

    await logActivity({
      storeId: session.storeId,
      userId: session.userId,
      action: "user.updated",
      entity: "User",
      entityId: id,
      metadata: { name: data.name },
    });

    revalidatePath("/users");
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: t("sellerEmailExists") };
    }
    throw error;
  }
}

export async function toggleSellerStatus(id: string) {
  const session = await requireSellerManager();
  const t = await getTranslations({ locale: toAppLocale(session.locale), namespace: "people.actions" });
  const seller = await requireOwnedSeller(id, session.storeId);
  if (!seller) return { error: t("sellerNotFound") };

  const nextStatus = seller.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
  await prisma.user.update({ where: { id }, data: { status: nextStatus } });

  await logActivity({
    storeId: session.storeId,
    userId: session.userId,
    action: "user.status_changed",
    entity: "User",
    entityId: id,
    metadata: { name: seller.name, status: nextStatus },
  });

  revalidatePath("/users");
  return { success: true as const, status: nextStatus };
}

export async function deleteSeller(id: string) {
  const session = await requireSellerManager();
  const t = await getTranslations({ locale: toAppLocale(session.locale), namespace: "people.actions" });
  const seller = await requireOwnedSeller(id, session.storeId);
  if (!seller) return { error: t("sellerNotFound") };

  try {
    await prisma.user.delete({ where: { id } });

    await logActivity({
      storeId: session.storeId,
      userId: session.userId,
      action: "user.deleted",
      entity: "User",
      entityId: id,
      metadata: { name: seller.name },
    });

    revalidatePath("/users");
    return { success: true as const, deactivated: false };
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      await prisma.user.update({ where: { id }, data: { status: "INACTIVE" } });

      await logActivity({
        storeId: session.storeId,
        userId: session.userId,
        action: "user.deactivated",
        entity: "User",
        entityId: id,
        metadata: { name: seller.name, reason: "has dependent records" },
      });

      revalidatePath("/users");
      return { success: true as const, deactivated: true };
    }
    throw error;
  }
}

export async function resetSellerPassword(id: string) {
  const session = await requireSellerManager();
  const t = await getTranslations({ locale: toAppLocale(session.locale), namespace: "people.actions" });
  const seller = await requireOwnedSeller(id, session.storeId);
  if (!seller) return { error: t("sellerNotFound") };

  const tempPassword = generateTempPassword();

  try {
    const passwordHash = await hashPassword(tempPassword);
    await prisma.user.update({ where: { id }, data: { passwordHash } });

    await logActivity({
      storeId: session.storeId,
      userId: session.userId,
      action: "user.password_reset",
      entity: "User",
      entityId: id,
      metadata: { name: seller.name },
    });

    revalidatePath("/users");
    return { success: true as const, tempPassword };
  } catch {
    return { error: t("resetPasswordFailed") };
  }
}
