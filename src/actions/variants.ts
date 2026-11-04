"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireStorePermission } from "@/lib/rbac-guards";
import { logActivity } from "@/lib/audit";
import { buildVariantSchema, type VariantInput } from "@/lib/validations/variant";
import { toAppLocale } from "@/i18n/messages";
import { getStoreFeatures } from "@/lib/features";
import { validateAxisValues } from "@/lib/variant-axes";
import { round3 } from "@/lib/sale-math";
import { Prisma } from "@/generated/prisma/client";
import { touchProductForVariant } from "@/lib/inventory";

const requireVariantManager = requireStorePermission("product.edit");

/**
 * Validates submitted custom axis values against the store's active axis
 * definitions. When the flag is off, custom axes are ignored entirely (Size/
 * Color-only behavior is preserved).
 */
async function resolveAxisValues(
  storeId: string,
  raw: Record<string, string> | undefined
): Promise<{ enabled: false } | { enabled: true; cleaned: Record<string, string> } | { error: string }> {
  const features = await getStoreFeatures(storeId);
  if (!features.custom_variant_axes_enabled) return { enabled: false };
  const axes = await prisma.variantAxisDefinition.findMany({
    where: { storeId, isActive: true },
    select: { key: true },
  });
  const check = validateAxisValues(raw ?? {}, new Set(axes.map((a) => a.key)));
  if (!check.ok) return { error: check.error };
  return { enabled: true, cleaned: check.cleaned };
}

/** Enforces the parent product's decimal-quantity policy on a variant's stock. */
async function resolveVariantStock(
  storeId: string,
  productAllowsDecimal: boolean,
  rawStock: number,
  t: Awaited<ReturnType<typeof getTranslations>>
): Promise<{ stock: number } | { error: string }> {
  const features = await getStoreFeatures(storeId);
  const allowDecimal = features.units_enabled && productAllowsDecimal;
  if (!allowDecimal && !Number.isInteger(rawStock)) {
    return { error: t("stockWholeNumber") };
  }
  return { stock: round3(rawStock) };
}

/** Verifies optional size/color ids belong to this store; returns cleaned ids. */
async function resolveAxes(
  storeId: string,
  t: Awaited<ReturnType<typeof getTranslations>>,
  sizeId?: string,
  colorId?: string
) {
  const cleanSize = sizeId || null;
  const cleanColor = colorId || null;
  if (cleanSize) {
    const s = await prisma.size.findFirst({ where: { id: cleanSize, storeId }, select: { id: true } });
    if (!s) return { error: t("sizeNotFound") };
  }
  if (cleanColor) {
    const c = await prisma.color.findFirst({ where: { id: cleanColor, storeId }, select: { id: true } });
    if (!c) return { error: t("colorNotFound") };
  }
  return { sizeId: cleanSize, colorId: cleanColor };
}

export async function createVariant(productId: string, input: VariantInput) {
  const session = await requireVariantManager();
  const locale = toAppLocale(session.locale);
  const tValidation = await getTranslations({ locale, namespace: "validation" });
  const t = await getTranslations({ locale, namespace: "products.actions.variant" });
  const parsed = buildVariantSchema(tValidation).safeParse(input);
  if (!parsed.success) return { error: t("invalidData") };
  const data = parsed.data;

  const product = await prisma.product.findFirst({
    where: { id: productId, storeId: session.storeId },
    select: { id: true, allowDecimalQuantity: true, trackBatch: true },
  });
  if (!product) return { error: t("productNotFound") };

  const stockResult = await resolveVariantStock(session.storeId, product.allowDecimalQuantity, data.stock, t);
  if ("error" in stockResult) return { error: stockResult.error };
  const stock = stockResult.stock;

  // On a batch-tracked product, a new variant must start empty; its stock is
  // received into a batch afterwards so the batch ledger stays authoritative.
  if (product.trackBatch && round3(stock) !== 0) {
    return { error: t("batchTrackedCreateZero") };
  }

  const axes = await resolveAxes(session.storeId, t, data.sizeId || undefined, data.colorId || undefined);
  if ("error" in axes) return { error: axes.error };

  const axisResult = await resolveAxisValues(session.storeId, data.axisValues);
  if ("error" in axisResult) return { error: axisResult.error };

  try {
    const variant = await prisma.$transaction(async (tx) => {
      const created = await tx.productVariant.create({
        data: {
          storeId: session.storeId,
          productId,
          sizeId: axes.sizeId,
          colorId: axes.colorId,
          sku: data.sku,
          barcode: data.barcode || null,
          sellingPrice: data.sellingPrice ?? null,
          fabricationPrice: data.fabricationPrice ?? null,
          stock,
          isActive: data.isActive ?? true,
          imageUrl: data.imageUrl || null,
          axisValues: axisResult.enabled ? axisResult.cleaned : Prisma.JsonNull,
        },
      });

      if (stock > 0) {
        await tx.inventoryMovement.create({
          data: {
            storeId: session.storeId,
            productId,
            variantId: created.id,
            type: "IN",
            quantity: stock,
            note: "Initial variant stock",
            createdById: session.userId,
          },
        });
      }
      return created;
    });

    await logActivity({
      storeId: session.storeId,
      userId: session.userId,
      action: "variant.created",
      entity: "ProductVariant",
      entityId: variant.id,
      metadata: { productId, sku: variant.sku },
    });

    revalidatePath(`/products/${productId}/edit`);
    revalidatePath("/products");
    return { success: true as const, id: variant.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: t("skuExists") };
    }
    throw error;
  }
}

export async function updateVariant(id: string, input: VariantInput) {
  const session = await requireVariantManager();
  const locale = toAppLocale(session.locale);
  const tValidation = await getTranslations({ locale, namespace: "validation" });
  const t = await getTranslations({ locale, namespace: "products.actions.variant" });
  const parsed = buildVariantSchema(tValidation).safeParse(input);
  if (!parsed.success) return { error: t("invalidData") };
  const data = parsed.data;

  const existing = await prisma.productVariant.findFirst({
    where: { id, storeId: session.storeId },
    include: { product: { select: { allowDecimalQuantity: true, trackBatch: true } } },
  });
  if (!existing) return { error: t("notFound") };

  const stockResult = await resolveVariantStock(
    session.storeId,
    existing.product.allowDecimalQuantity,
    data.stock,
    t
  );
  if ("error" in stockResult) return { error: stockResult.error };
  const stock = stockResult.stock;
  const existingStock = Number(existing.stock);

  // Batch-tracked variants: stock is owned by the batch ledger, not this form.
  if (existing.product.trackBatch && round3(stock) !== round3(existingStock)) {
    return { error: t("batchTrackedAdjustElsewhere") };
  }

  const axes = await resolveAxes(session.storeId, t, data.sizeId || undefined, data.colorId || undefined);
  if ("error" in axes) return { error: axes.error };

  const axisResult = await resolveAxisValues(session.storeId, data.axisValues);
  if ("error" in axisResult) return { error: axisResult.error };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.productVariant.update({
        where: { id },
        data: {
          sizeId: axes.sizeId,
          colorId: axes.colorId,
          sku: data.sku,
          barcode: data.barcode || null,
          sellingPrice: data.sellingPrice ?? null,
          fabricationPrice: data.fabricationPrice ?? null,
          stock,
          isActive: data.isActive ?? existing.isActive,
          imageUrl: data.imageUrl || null,
          // Only touch axisValues when custom axes are enabled (else preserve).
          ...(axisResult.enabled ? { axisValues: axisResult.cleaned } : {}),
        },
      });

      if (stock !== existingStock) {
        // Variant-only write: bump the parent so /api/v1/stock?updatedSince= sees it.
        await touchProductForVariant(tx, id);
        await tx.inventoryMovement.create({
          data: {
            storeId: session.storeId,
            productId: existing.productId,
            variantId: id,
            type: "ADJUSTMENT",
            quantity: round3(stock - existingStock),
            note: "Manual variant stock adjustment",
            createdById: session.userId,
          },
        });
      }
    });

    revalidatePath(`/products/${existing.productId}/edit`);
    revalidatePath("/products");
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: t("skuExists") };
    }
    throw error;
  }
}

export async function deleteVariant(id: string) {
  const session = await requireVariantManager();
  const t = await getTranslations({ locale: toAppLocale(session.locale), namespace: "products.actions.variant" });
  const existing = await prisma.productVariant.findFirst({
    where: { id, storeId: session.storeId },
  });
  if (!existing) return { error: t("notFound") };

  try {
    await prisma.productVariant.delete({ where: { id } });
    revalidatePath(`/products/${existing.productId}/edit`);
    revalidatePath("/products");
    return { success: true as const, archived: false };
  } catch {
    // Sold variants are referenced by sale items (RESTRICT) — deactivate instead.
    await prisma.productVariant.update({ where: { id }, data: { isActive: false } });
    revalidatePath(`/products/${existing.productId}/edit`);
    revalidatePath("/products");
    return { success: true as const, archived: true };
  }
}
