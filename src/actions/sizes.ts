"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireStorePermission } from "@/lib/rbac-guards";
import { buildSizeSchema, type SizeInput } from "@/lib/validations/size";
import { toAppLocale } from "@/i18n/messages";
import { Prisma } from "@/generated/prisma/client";

// Sizes are catalog configuration, managed by the store's Manager.
const requireSizeManager = requireStorePermission("category.manage");

export async function createSize(input: SizeInput) {
  const session = await requireSizeManager();
  const locale = toAppLocale(session.locale);
  const tValidation = await getTranslations({ locale, namespace: "validation" });
  const t = await getTranslations({ locale, namespace: "catalog.actions.sizes" });
  const parsed = buildSizeSchema(tValidation).safeParse(input);
  if (!parsed.success) return { error: t("invalidData") };

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
      return { error: t("nameExists") };
    }
    throw error;
  }
}

export async function updateSize(id: string, input: SizeInput) {
  const session = await requireSizeManager();
  const locale = toAppLocale(session.locale);
  const tValidation = await getTranslations({ locale, namespace: "validation" });
  const t = await getTranslations({ locale, namespace: "catalog.actions.sizes" });
  const parsed = buildSizeSchema(tValidation).safeParse(input);
  if (!parsed.success) return { error: t("invalidData") };

  const existing = await prisma.size.findFirst({ where: { id, storeId: session.storeId } });
  if (!existing) return { error: t("notFound") };

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
      return { error: t("nameExists") };
    }
    throw error;
  }
}

export async function deleteSize(id: string) {
  const session = await requireSizeManager();
  const t = await getTranslations({ locale: toAppLocale(session.locale), namespace: "catalog.actions.sizes" });
  const existing = await prisma.size.findFirst({ where: { id, storeId: session.storeId } });
  if (!existing) return { error: t("notFound") };

  try {
    await prisma.size.delete({ where: { id } });
    revalidatePath("/sizes");
    revalidatePath("/products");
    return { success: true as const };
  } catch {
    return { error: t("deleteFailed") };
  }
}
