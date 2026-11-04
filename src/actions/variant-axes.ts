"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireStorePermission } from "@/lib/rbac-guards";
import { slugify } from "@/lib/utils";
import { buildVariantAxisSchema, type VariantAxisInput } from "@/lib/validations/variant-axis";
import { toAppLocale } from "@/i18n/messages";
import { Prisma } from "@/generated/prisma/client";

// Variant axes are catalog configuration, managed by the store's Manager.
const requireAxisManager = requireStorePermission("category.manage");

export async function createVariantAxis(input: VariantAxisInput) {
  const session = await requireAxisManager();
  const locale = toAppLocale(session.locale);
  const tValidation = await getTranslations({ locale, namespace: "validation" });
  const t = await getTranslations({ locale, namespace: "catalog.actions.variantAxes" });
  const parsed = buildVariantAxisSchema(tValidation).safeParse(input);
  if (!parsed.success) return { error: t("invalidData") };
  const data = parsed.data;
  const key = slugify(data.label) || "axis";

  try {
    await prisma.variantAxisDefinition.create({
      data: {
        storeId: session.storeId,
        key,
        label: data.label,
        position: data.position ?? 0,
        isActive: data.isActive ?? true,
      },
    });
    revalidatePath("/variant-axes");
    revalidatePath("/products");
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: t("labelExists") };
    }
    throw error;
  }
}

export async function updateVariantAxis(id: string, input: VariantAxisInput) {
  const session = await requireAxisManager();
  const locale = toAppLocale(session.locale);
  const tValidation = await getTranslations({ locale, namespace: "validation" });
  const t = await getTranslations({ locale, namespace: "catalog.actions.variantAxes" });
  const parsed = buildVariantAxisSchema(tValidation).safeParse(input);
  if (!parsed.success) return { error: t("invalidData") };
  const data = parsed.data;

  const existing = await prisma.variantAxisDefinition.findFirst({
    where: { id, storeId: session.storeId },
  });
  if (!existing) return { error: t("notFound") };

  const key = slugify(data.label) || "axis";

  try {
    await prisma.variantAxisDefinition.update({
      where: { id },
      data: {
        key,
        label: data.label,
        position: data.position ?? existing.position,
        isActive: data.isActive ?? existing.isActive,
      },
    });
    revalidatePath("/variant-axes");
    revalidatePath("/products");
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: t("labelExists") };
    }
    throw error;
  }
}

export async function deleteVariantAxis(id: string) {
  const session = await requireAxisManager();
  const t = await getTranslations({ locale: toAppLocale(session.locale), namespace: "catalog.actions.variantAxes" });
  const existing = await prisma.variantAxisDefinition.findFirst({
    where: { id, storeId: session.storeId },
    select: { id: true },
  });
  if (!existing) return { error: t("notFound") };

  // Any values already stored on variants under this axis key simply stop being
  // displayed (label/display filters by the active axis set).
  await prisma.variantAxisDefinition.delete({ where: { id } });
  revalidatePath("/variant-axes");
  revalidatePath("/products");
  return { success: true as const };
}
