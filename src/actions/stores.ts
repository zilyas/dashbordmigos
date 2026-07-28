"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { logActivity } from "@/lib/audit";
import { storeSchema, type StoreInput } from "@/lib/validations/store";
import { Prisma } from "@/generated/prisma/client";
import type { StoreStatus } from "@/generated/prisma/enums";

async function requireStoreManager() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, "store.manage")) {
    throw new Error("Not authorized");
  }
  return session;
}

export async function createStore(input: StoreInput) {
  const session = await requireStoreManager();
  const parsed = storeSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid store data" };
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
          title: "New store created",
          message: `${store.name} (${store.code}) was added to the platform.`,
        })),
      });
    }

    revalidatePath("/stores");
    return { success: true as const, id: store.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A store with that code already exists." };
    }
    throw error;
  }
}

export async function updateStore(id: string, input: StoreInput) {
  const session = await requireStoreManager();
  const parsed = storeSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid store data" };
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
      return { error: "A store with that code already exists." };
    }
    throw error;
  }
}

export async function toggleStoreStatus(id: string) {
  const session = await requireStoreManager();
  const store = await prisma.store.findUnique({ where: { id } });
  if (!store) return { error: "Store not found" };

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
  const store = await prisma.store.findUnique({ where: { id } });
  if (!store) return { error: "Store not found" };

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
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
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
