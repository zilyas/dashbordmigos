"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { requireStorePermission } from "@/lib/rbac-guards";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { logActivity } from "@/lib/audit";
import { productSchema, type ProductInput } from "@/lib/validations/product";
import { slugify } from "@/lib/utils";
import { Prisma } from "@/generated/prisma/client";
import { isForeignKeyConstraintError } from "@/lib/prisma-errors";
import type { ProductStatus } from "@/generated/prisma/enums";

function computeProfitMargin(sellingPrice: number, fabricationPrice: number) {
  if (sellingPrice <= 0) return 0;
  return ((sellingPrice - fabricationPrice) / sellingPrice) * 100;
}

const requireProductEditor = requireStorePermission("product.create");

async function uniqueSlug(storeId: string, base: string, excludeId?: string) {
  const slugBase = slugify(base) || "product";
  let slug = slugBase;
  let i = 1;
  while (
    await prisma.product.findFirst({
      where: { storeId, slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    })
  ) {
    slug = `${slugBase}-${++i}`;
  }
  return slug;
}

export async function createProduct(input: ProductInput) {
  const session = await requireProductEditor();
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid product data" };
  const data = parsed.data;

  const slug = await uniqueSlug(session.storeId, `${data.name}-${data.color || ""}-${data.size || ""}`);

  try {
    const product = await prisma.product.create({
      data: {
        storeId: session.storeId,
        sku: data.sku,
        barcode: data.barcode || null,
        name: data.name,
        slug,
        description: data.description || null,
        categoryId: data.categoryId || null,
        type: data.type || null,
        size: data.size || null,
        color: data.color || null,
        fabricationPrice: data.fabricationPrice,
        sellingPrice: data.sellingPrice,
        profitMargin: computeProfitMargin(data.sellingPrice, data.fabricationPrice),
        stock: data.stock,
        minimumStock: data.minimumStock,
        status: data.status,
        createdById: session.userId,
        images: { create: data.images.map((url, position) => ({ url, position })) },
      },
    });

    if (data.stock > 0) {
      await prisma.inventoryMovement.create({
        data: {
          storeId: session.storeId,
          productId: product.id,
          type: "IN",
          quantity: data.stock,
          note: "Initial stock on product creation",
          createdById: session.userId,
        },
      });
    }

    await logActivity({
      storeId: session.storeId,
      userId: session.userId,
      action: "product.created",
      entity: "Product",
      entityId: product.id,
      metadata: { name: product.name, sku: product.sku },
    });

    revalidatePath("/products");
    revalidatePath("/dashboard");
    return { success: true as const, id: product.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A product with that SKU or barcode already exists." };
    }
    throw error;
  }
}

export async function updateProduct(id: string, input: ProductInput) {
  const session = await requireProductEditor();
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid product data" };
  const data = parsed.data;

  const existing = await prisma.product.findFirst({ where: { id, storeId: session.storeId } });
  if (!existing) return { error: "Product not found" };

  const slug =
    slugify(existing.name) === slugify(data.name)
      ? existing.slug
      : await uniqueSlug(session.storeId, `${data.name}-${data.color || ""}-${data.size || ""}`, id);

  const priceChanged =
    Number(existing.sellingPrice) !== data.sellingPrice || Number(existing.fabricationPrice) !== data.fabricationPrice;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          sku: data.sku,
          barcode: data.barcode || null,
          name: data.name,
          slug,
          description: data.description || null,
          categoryId: data.categoryId || null,
          type: data.type || null,
          size: data.size || null,
          color: data.color || null,
          fabricationPrice: data.fabricationPrice,
          sellingPrice: data.sellingPrice,
          profitMargin: computeProfitMargin(data.sellingPrice, data.fabricationPrice),
          stock: data.stock,
          minimumStock: data.minimumStock,
          status: data.status,
        },
      });

      if (data.stock !== existing.stock) {
        await tx.inventoryMovement.create({
          data: {
            storeId: session.storeId,
            productId: id,
            type: "ADJUSTMENT",
            quantity: data.stock - existing.stock,
            note: "Manual stock adjustment via product edit",
            createdById: session.userId,
          },
        });
      }

      await tx.productImage.deleteMany({ where: { productId: id } });
      if (data.images.length > 0) {
        await tx.productImage.createMany({
          data: data.images.map((url, position) => ({ productId: id, url, position })),
        });
      }

      await logActivity(
        {
          storeId: session.storeId,
          userId: session.userId,
          action: "product.updated",
          entity: "Product",
          entityId: id,
          metadata: {
            name: data.name,
            sku: data.sku,
            ...(priceChanged
              ? {
                  priceChange: {
                    sellingPrice: { from: Number(existing.sellingPrice), to: data.sellingPrice },
                    fabricationPrice: { from: Number(existing.fabricationPrice), to: data.fabricationPrice },
                  },
                }
              : {}),
          },
        },
        tx
      );
    });

    revalidatePath("/products");
    revalidatePath("/dashboard");
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A product with that SKU or barcode already exists." };
    }
    throw error;
  }
}

export async function deleteProduct(id: string) {
  const context = await getSessionContext();
  if (!context || !can(context.role, "product.delete")) {
    return { error: "Not authorized" };
  }
  const storeId = requireStoreId(context);

  const existing = await prisma.product.findFirst({ where: { id, storeId } });
  if (!existing) return { error: "Product not found" };

  try {
    await prisma.product.delete({ where: { id } });

    await logActivity({
      storeId,
      userId: context.userId,
      action: "product.deleted",
      entity: "Product",
      entityId: id,
      metadata: { name: existing.name, sku: existing.sku },
    });

    revalidatePath("/products");
    return { success: true as const, archived: false };
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      await prisma.product.update({ where: { id }, data: { status: "ARCHIVED" } });

      await logActivity({
        storeId,
        userId: context.userId,
        action: "product.archived",
        entity: "Product",
        entityId: id,
        metadata: { name: existing.name, sku: existing.sku, reason: "has dependent records" },
      });

      revalidatePath("/products");
      return { success: true as const, archived: true };
    }
    throw error;
  }
}

export async function bulkUpdateProductStatus(ids: string[], status: ProductStatus) {
  const context = await getSessionContext();
  if (!context || !can(context.role, "product.edit")) {
    return { error: "Not authorized" };
  }
  const storeId = requireStoreId(context);

  await prisma.product.updateMany({ where: { id: { in: ids }, storeId }, data: { status } });

  await logActivity({
    storeId,
    userId: context.userId,
    action: "product.bulk_status_changed",
    entity: "Product",
    metadata: { count: ids.length, status },
  });

  revalidatePath("/products");
  return { success: true as const };
}
