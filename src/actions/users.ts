"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireStorePermission } from "@/lib/rbac-guards";
import { generateTempPassword, hashPassword } from "@/lib/security/password";
import { logActivity } from "@/lib/audit";
import {
  createSellerSchema,
  updateSellerSchema,
  type CreateSellerInput,
  type UpdateSellerInput,
} from "@/lib/validations/user";
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
  const parsed = createSellerSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid seller data" };
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
        title: "Welcome to the team",
        message: "Your seller account has been created. Sign in to get started.",
      },
    });

    revalidatePath("/users");
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A user with that email already exists." };
    }
    throw error;
  }
}

export async function updateSeller(id: string, input: UpdateSellerInput) {
  const session = await requireSellerManager();
  const parsed = updateSellerSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid seller data" };
  const data = parsed.data;

  const seller = await requireOwnedSeller(id, session.storeId);
  if (!seller) return { error: "Seller not found" };

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
      return { error: "A user with that email already exists." };
    }
    throw error;
  }
}

export async function toggleSellerStatus(id: string) {
  const session = await requireSellerManager();
  const seller = await requireOwnedSeller(id, session.storeId);
  if (!seller) return { error: "Seller not found" };

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
  const seller = await requireOwnedSeller(id, session.storeId);
  if (!seller) return { error: "Seller not found" };

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
  const seller = await requireOwnedSeller(id, session.storeId);
  if (!seller) return { error: "Seller not found" };

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
    return { error: "Failed to reset password." };
  }
}
