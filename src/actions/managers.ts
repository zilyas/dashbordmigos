"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac-guards";
import { generateTempPassword, hashPassword } from "@/lib/security/password";
import { logActivity } from "@/lib/audit";
import {
  createManagerSchema,
  updateManagerSchema,
  type CreateManagerInput,
  type UpdateManagerInput,
} from "@/lib/validations/manager";
import { Prisma } from "@/generated/prisma/client";
import { isForeignKeyConstraintError } from "@/lib/prisma-errors";

const requirePlatformAdmin = requirePermission("manager.manage");

async function requireManagerRow(id: string) {
  return prisma.user.findFirst({ where: { id, role: "MANAGER" } });
}

export async function createManager(input: CreateManagerInput) {
  const session = await requirePlatformAdmin();
  const parsed = createManagerSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid manager data" };
  const data = parsed.data;

  const store = await prisma.store.findUnique({ where: { id: data.storeId } });
  if (!store) return { error: "Store not found" };

  try {
    const passwordHash = await hashPassword(data.password);
    const manager = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash,
        role: "MANAGER",
        storeId: data.storeId,
        createdById: session.user.id,
        phone: data.phone || null,
      },
    });

    await logActivity({
      storeId: data.storeId,
      userId: session.user.id,
      action: "manager.created",
      entity: "User",
      entityId: manager.id,
      metadata: { name: manager.name, storeName: store.name },
    });

    await prisma.notification.create({
      data: {
        storeId: data.storeId,
        userId: manager.id,
        type: "MANAGER_ASSIGNED",
        title: "You've been assigned a store",
        message: `You're now managing ${store.name}. Sign in to get started.`,
      },
    });

    revalidatePath("/managers");
    revalidatePath("/stores");
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A user with that email already exists." };
    }
    throw error;
  }
}

export async function updateManager(id: string, input: UpdateManagerInput) {
  const session = await requirePlatformAdmin();
  const parsed = updateManagerSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid manager data" };
  const data = parsed.data;

  const manager = await requireManagerRow(id);
  if (!manager) return { error: "Manager not found" };

  try {
    await prisma.user.update({
      where: { id },
      data: { name: data.name, email: data.email, phone: data.phone || null },
    });

    await logActivity({
      storeId: manager.storeId,
      userId: session.user.id,
      action: "manager.updated",
      entity: "User",
      entityId: id,
      metadata: { name: data.name },
    });

    revalidatePath("/managers");
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A user with that email already exists." };
    }
    throw error;
  }
}

export async function toggleManagerStatus(id: string) {
  const session = await requirePlatformAdmin();
  const manager = await requireManagerRow(id);
  if (!manager) return { error: "Manager not found" };

  const nextStatus = manager.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
  await prisma.user.update({ where: { id }, data: { status: nextStatus } });

  await logActivity({
    storeId: manager.storeId,
    userId: session.user.id,
    action: "manager.status_changed",
    entity: "User",
    entityId: id,
    metadata: { name: manager.name, status: nextStatus },
  });

  revalidatePath("/managers");
  return { success: true as const, status: nextStatus };
}

export async function deleteManager(id: string) {
  const session = await requirePlatformAdmin();
  const manager = await requireManagerRow(id);
  if (!manager) return { error: "Manager not found" };

  try {
    await prisma.user.delete({ where: { id } });

    await logActivity({
      storeId: manager.storeId,
      userId: session.user.id,
      action: "manager.deleted",
      entity: "User",
      entityId: id,
      metadata: { name: manager.name },
    });

    revalidatePath("/managers");
    return { success: true as const, deactivated: false };
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      await prisma.user.update({ where: { id }, data: { status: "INACTIVE" } });

      await logActivity({
        storeId: manager.storeId,
        userId: session.user.id,
        action: "manager.deactivated",
        entity: "User",
        entityId: id,
        metadata: { name: manager.name, reason: "has dependent records" },
      });

      revalidatePath("/managers");
      return { success: true as const, deactivated: true };
    }
    throw error;
  }
}

export async function resetManagerPassword(id: string) {
  const session = await requirePlatformAdmin();
  const manager = await requireManagerRow(id);
  if (!manager) return { error: "Manager not found" };

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await prisma.user.update({ where: { id }, data: { passwordHash } });

  await logActivity({
    storeId: manager.storeId,
    userId: session.user.id,
    action: "manager.password_reset",
    entity: "User",
    entityId: id,
    metadata: { name: manager.name },
  });

  revalidatePath("/managers");
  return { success: true as const, tempPassword };
}

export async function transferManager(id: string, newStoreId: string) {
  const session = await requirePlatformAdmin();
  const manager = await requireManagerRow(id);
  if (!manager) return { error: "Manager not found" };

  const store = await prisma.store.findUnique({ where: { id: newStoreId } });
  if (!store) return { error: "Store not found" };

  await prisma.user.update({ where: { id }, data: { storeId: newStoreId } });

  await logActivity({
    storeId: newStoreId,
    userId: session.user.id,
    action: "manager.transferred",
    entity: "User",
    entityId: id,
    metadata: { name: manager.name, storeName: store.name },
  });

  await prisma.notification.create({
    data: {
      storeId: newStoreId,
      userId: id,
      type: "MANAGER_ASSIGNED",
      title: "You've been transferred",
      message: `You're now managing ${store.name}.`,
    },
  });

  revalidatePath("/managers");
  revalidatePath("/stores");
  return { success: true as const };
}
