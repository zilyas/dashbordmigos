"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireStorePermission } from "@/lib/rbac-guards";
import { categorySchema, type CategoryInput } from "@/lib/validations/category";
import { slugify } from "@/lib/utils";
import { Prisma } from "@/generated/prisma/client";

const requireCategoryManager = requireStorePermission("category.manage");

export async function createCategory(input: CategoryInput) {
  const session = await requireCategoryManager();
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid category data" };

  try {
    await prisma.category.create({
      data: {
        storeId: session.storeId,
        name: parsed.data.name,
        slug: slugify(parsed.data.name),
        description: parsed.data.description || null,
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

  try {
    await prisma.category.update({
      where: { id },
      data: {
        name: parsed.data.name,
        slug: slugify(parsed.data.name),
        description: parsed.data.description || null,
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
