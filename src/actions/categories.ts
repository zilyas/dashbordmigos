"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireStorePermission } from "@/lib/rbac-guards";
import { buildCategorySchema, type CategoryInput } from "@/lib/validations/category";
import { toAppLocale } from "@/i18n/messages";
import { slugify } from "@/lib/utils";
import { Prisma } from "@/generated/prisma/client";

const requireCategoryManager = requireStorePermission("category.manage");

/** Validates an optional parent id belongs to the store and isn't self. */
async function resolveParent(
  storeId: string,
  t: Awaited<ReturnType<typeof getTranslations>>,
  parentId?: string,
  selfId?: string
) {
  const clean = parentId || null;
  if (!clean) return { parentId: null as string | null };
  if (clean === selfId) return { error: t("cannotBeOwnParent") };
  const parent = await prisma.category.findFirst({ where: { id: clean, storeId }, select: { id: true } });
  if (!parent) return { error: t("parentNotFound") };
  return { parentId: clean };
}

export async function createCategory(input: CategoryInput) {
  const session = await requireCategoryManager();
  const locale = toAppLocale(session.locale);
  const tValidation = await getTranslations({ locale, namespace: "validation" });
  const t = await getTranslations({ locale, namespace: "catalog.actions.categories" });
  const parsed = buildCategorySchema(tValidation).safeParse(input);
  if (!parsed.success) return { error: t("invalidData") };

  const parent = await resolveParent(session.storeId, t, parsed.data.parentId || undefined);
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
      return { error: t("nameExists") };
    }
    throw error;
  }
}

export async function updateCategory(id: string, input: CategoryInput) {
  const session = await requireCategoryManager();
  const locale = toAppLocale(session.locale);
  const tValidation = await getTranslations({ locale, namespace: "validation" });
  const t = await getTranslations({ locale, namespace: "catalog.actions.categories" });
  const parsed = buildCategorySchema(tValidation).safeParse(input);
  if (!parsed.success) return { error: t("invalidData") };

  const existing = await prisma.category.findFirst({ where: { id, storeId: session.storeId } });
  if (!existing) return { error: t("notFound") };

  const parent = await resolveParent(session.storeId, t, parsed.data.parentId || undefined, id);
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
      return { error: t("nameExists") };
    }
    throw error;
  }
}

export async function deleteCategory(id: string) {
  const session = await requireCategoryManager();
  const t = await getTranslations({ locale: toAppLocale(session.locale), namespace: "catalog.actions.categories" });
  const existing = await prisma.category.findFirst({ where: { id, storeId: session.storeId } });
  if (!existing) return { error: t("notFound") };

  try {
    await prisma.category.delete({ where: { id } });
    revalidatePath("/categories");
    revalidatePath("/products");
    return { success: true as const };
  } catch {
    return { error: t("deleteFailed") };
  }
}
