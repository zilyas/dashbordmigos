"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireStorePermission } from "@/lib/rbac-guards";
import { buildColorSchema, type ColorInput } from "@/lib/validations/color";
import { toAppLocale } from "@/i18n/messages";
import { Prisma } from "@/generated/prisma/client";

const requireColorManager = requireStorePermission("category.manage");

export async function createColor(input: ColorInput) {
  const session = await requireColorManager();
  const locale = toAppLocale(session.locale);
  const tValidation = await getTranslations({ locale, namespace: "validation" });
  const t = await getTranslations({ locale, namespace: "catalog.actions.colors" });
  const parsed = buildColorSchema(tValidation).safeParse(input);
  if (!parsed.success) return { error: t("invalidData") };

  try {
    await prisma.color.create({
      data: {
        storeId: session.storeId,
        name: parsed.data.name,
        hex: parsed.data.hex || null,
        position: parsed.data.position ?? 0,
      },
    });
    revalidatePath("/colors");
    revalidatePath("/products");
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: t("nameExists") };
    }
    throw error;
  }
}

export async function updateColor(id: string, input: ColorInput) {
  const session = await requireColorManager();
  const locale = toAppLocale(session.locale);
  const tValidation = await getTranslations({ locale, namespace: "validation" });
  const t = await getTranslations({ locale, namespace: "catalog.actions.colors" });
  const parsed = buildColorSchema(tValidation).safeParse(input);
  if (!parsed.success) return { error: t("invalidData") };

  const existing = await prisma.color.findFirst({ where: { id, storeId: session.storeId } });
  if (!existing) return { error: t("notFound") };

  try {
    await prisma.color.update({
      where: { id },
      data: {
        name: parsed.data.name,
        hex: parsed.data.hex || null,
        position: parsed.data.position ?? existing.position,
      },
    });
    revalidatePath("/colors");
    revalidatePath("/products");
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: t("nameExists") };
    }
    throw error;
  }
}

export async function deleteColor(id: string) {
  const session = await requireColorManager();
  const t = await getTranslations({ locale: toAppLocale(session.locale), namespace: "catalog.actions.colors" });
  const existing = await prisma.color.findFirst({ where: { id, storeId: session.storeId } });
  if (!existing) return { error: t("notFound") };

  try {
    await prisma.color.delete({ where: { id } });
    revalidatePath("/colors");
    revalidatePath("/products");
    return { success: true as const };
  } catch {
    return { error: t("deleteFailed") };
  }
}
