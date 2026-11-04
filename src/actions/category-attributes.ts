"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireStorePermission } from "@/lib/rbac-guards";
import { slugify } from "@/lib/utils";
import {
  buildAttributeDefinitionSchema,
  type AttributeDefinitionInput,
} from "@/lib/validations/category-attribute";
import { toAppLocale } from "@/i18n/messages";
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
  const locale = toAppLocale(session.locale);
  const tValidation = await getTranslations({ locale, namespace: "validation" });
  const t = await getTranslations({ locale, namespace: "catalog.actions.attributes" });
  const parsed = buildAttributeDefinitionSchema(tValidation).safeParse(input);
  if (!parsed.success) return { error: t("invalidData") };
  const data = parsed.data;

  if (!(await assertCategoryInStore(categoryId, session.storeId))) {
    return { error: t("notFound") };
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
      return { error: t("labelExists") };
    }
    throw error;
  }
}

export async function updateAttributeDefinition(id: string, input: AttributeDefinitionInput) {
  const session = await requireAttributeManager();
  const locale = toAppLocale(session.locale);
  const tValidation = await getTranslations({ locale, namespace: "validation" });
  const t = await getTranslations({ locale, namespace: "catalog.actions.attributes" });
  const parsed = buildAttributeDefinitionSchema(tValidation).safeParse(input);
  if (!parsed.success) return { error: t("invalidData") };
  const data = parsed.data;

  const existing = await prisma.categoryAttributeDefinition.findFirst({
    where: { id, storeId: session.storeId },
  });
  if (!existing) return { error: t("notFound") };

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
      return { error: t("labelExists") };
    }
    throw error;
  }
}

export async function deleteAttributeDefinition(id: string) {
  const session = await requireAttributeManager();
  const t = await getTranslations({ locale: toAppLocale(session.locale), namespace: "catalog.actions.attributes" });
  const existing = await prisma.categoryAttributeDefinition.findFirst({
    where: { id, storeId: session.storeId },
    select: { id: true },
  });
  if (!existing) return { error: t("notFound") };

  // Product values cascade with the definition.
  await prisma.categoryAttributeDefinition.delete({ where: { id } });
  revalidatePath("/categories");
  revalidatePath("/products");
  return { success: true as const };
}
