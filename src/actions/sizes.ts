"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireStorePermission } from "@/lib/rbac-guards";
import { sizeSchema, type SizeInput } from "@/lib/validations/size";
import { Prisma } from "@/generated/prisma/client";

// Sizes are catalog configuration, managed by the store's Manager.
const requireSizeManager = requireStorePermission("category.manage");

export async function createSize(input: SizeInput) {
  const session = await requireSizeManager();
  const parsed = sizeSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid size data" };

  try {
    await prisma.size.create({
      data: {
        storeId: session.storeId,
        name: parsed.data.name,
        position: parsed.data.position ?? 0,
      },
    });
    revalidatePath("/sizes");
    revalidatePath("/products");
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A size with that name already exists." };
    }
    throw error;
  }
}

export async function updateSize(id: string, input: SizeInput) {
  const session = await requireSizeManager();
  const parsed = sizeSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid size data" };

  const existing = await prisma.size.findFirst({ where: { id, storeId: session.storeId } });
  if (!existing) return { error: "Size not found" };

  try {
    await prisma.size.update({
      where: { id },
      data: { name: parsed.data.name, position: parsed.data.position ?? existing.position },
    });
    revalidatePath("/sizes");
    revalidatePath("/products");
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A size with that name already exists." };
    }
    throw error;
  }
}

export async function deleteSize(id: string) {
  const session = await requireSizeManager();
  const existing = await prisma.size.findFirst({ where: { id, storeId: session.storeId } });
  if (!existing) return { error: "Size not found" };

  try {
    await prisma.size.delete({ where: { id } });
    revalidatePath("/sizes");
    revalidatePath("/products");
    return { success: true as const };
  } catch {
    return { error: "Failed to delete size." };
  }
}
