"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireStorePermission } from "@/lib/rbac-guards";
import { categorySchema, type CategoryInput } from "@/lib/validations/category";
import { slugify } from "@/lib/utils";
import { Prisma } from "@/generated/prisma/client";

const requireCategoryManager = requireStorePermission("category.manage");

/** Validates an optional parent id belongs to the store and isn't self. */
async function resolveParent(storeId: string, parentId?: string, selfId?: string) {
  const clean = parentId || null;
  if (!clean) return { parentId: null as string | null };
  if (clean === selfId) return { error: "A category cannot be its own parent" as const };
  const parent = await prisma.category.findFirst({ where: { id: clean, storeId }, select: { id: true } });
  if (!parent) return { error: "Parent category not found" as const };
  return { parentId: clean };
}

export async function createCategory(input: CategoryInput) {
  const session = await requireCategoryManager();
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid category data" };

  const parent = await resolveParent(session.storeId, parsed.data.parentId || undefined);
  if ("error" in parent) return { error: parent.error };

  try {
    await prisma.category.create({
      data: {
        storeId: session.storeId,
        name: parsed.data.name,
        slug: slugify(parsed.data.name),
        description: parsed.data.description || null,
        isActive: parsed.data.isActive ?? true,
        parentId: parent.parentId,
        metadata: parsed.data.isClothing ? { clothing: true } : Prisma.JsonNull,
      },
    });
    revalidatePath("/categories");
    revalidatePath("/products");
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A category with that name already exists." };
    }
    throw error;
  }
}

export async function updateCategory(id: string, input: CategoryInput) {
  const session = await requireCategoryManager();
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid category data" };

  const existing = await prisma.category.findFirst({ where: { id, storeId: session.storeId } });
  if (!existing) return { error: "Category not found" };

  const parent = await resolveParent(session.storeId, parsed.data.parentId || undefined, id);
  if ("error" in parent) return { error: parent.error };

  try {
    await prisma.category.update({
      where: { id },
      data: {
        name: parsed.data.name,
        slug: slugify(parsed.data.name),
        description: parsed.data.description || null,
        isActive: parsed.data.isActive ?? existing.isActive,
        parentId: parent.parentId,
        metadata: parsed.data.isClothing ? { clothing: true } : Prisma.JsonNull,
      },
    });
    revalidatePath("/categories");
    revalidatePath("/products");
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A category with that name already exists." };
    }
    throw error;
  }
}

export async function deleteCategory(id: string) {
  const session = await requireCategoryManager();
  const existing = await prisma.category.findFirst({ where: { id, storeId: session.storeId } });
  if (!existing) return { error: "Category not found" };

  try {
    await prisma.category.delete({ where: { id } });
    revalidatePath("/categories");
    revalidatePath("/products");
    return { success: true as const };
  } catch {
    return { error: "Failed to delete category." };
  }
}
