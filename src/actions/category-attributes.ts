"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireStorePermission } from "@/lib/rbac-guards";
import { slugify } from "@/lib/utils";
import {
  attributeDefinitionSchema,
  type AttributeDefinitionInput,
} from "@/lib/validations/category-attribute";
import { Prisma } from "@/generated/prisma/client";

// Attribute definitions are catalog configuration, managed by the store's Manager.
const requireAttributeManager = requireStorePermission("category.manage");

/** Confirms a category belongs to the acting Manager's store. */
async function assertCategoryInStore(categoryId: string, storeId: string) {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, storeId },
    select: { id: true },
  });
  return Boolean(category);
}

export async function createAttributeDefinition(
  categoryId: string,
  input: AttributeDefinitionInput
) {
  const session = await requireAttributeManager();
  const parsed = attributeDefinitionSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid attribute data" };
  const data = parsed.data;

  if (!(await assertCategoryInStore(categoryId, session.storeId))) {
    return { error: "Category not found" };
  }

  const key = slugify(data.label) || "attribute";

  try {
    await prisma.categoryAttributeDefinition.create({
      data: {
        storeId: session.storeId,
        categoryId,
        key,
        label: data.label,
        type: data.type,
        options: data.type === "SELECT" ? (data.options ?? []) : Prisma.JsonNull,
        required: data.required ?? false,
        position: data.position ?? 0,
      },
    });
    revalidatePath("/categories");
    revalidatePath("/products");
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "An attribute with that label already exists in this category." };
    }
    throw error;
  }
}

export async function updateAttributeDefinition(id: string, input: AttributeDefinitionInput) {
  const session = await requireAttributeManager();
  const parsed = attributeDefinitionSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid attribute data" };
  const data = parsed.data;

  const existing = await prisma.categoryAttributeDefinition.findFirst({
    where: { id, storeId: session.storeId },
  });
  if (!existing) return { error: "Attribute not found" };

  const key = slugify(data.label) || "attribute";

  try {
    await prisma.categoryAttributeDefinition.update({
      where: { id },
      data: {
        key,
        label: data.label,
        type: data.type,
        options: data.type === "SELECT" ? (data.options ?? []) : Prisma.JsonNull,
        required: data.required ?? false,
        position: data.position ?? existing.position,
      },
    });
    revalidatePath("/categories");
    revalidatePath("/products");
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "An attribute with that label already exists in this category." };
    }
    throw error;
  }
}

export async function deleteAttributeDefinition(id: string) {
  const session = await requireAttributeManager();
  const existing = await prisma.categoryAttributeDefinition.findFirst({
    where: { id, storeId: session.storeId },
    select: { id: true },
  });
  if (!existing) return { error: "Attribute not found" };

  // Product values cascade with the definition.
  await prisma.categoryAttributeDefinition.delete({ where: { id } });
  revalidatePath("/categories");
  revalidatePath("/products");
  return { success: true as const };
}
