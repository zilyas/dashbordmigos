"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { requireStorePermission } from "@/lib/rbac-guards";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { logActivity } from "@/lib/audit";
import { productSchema, type ProductInput } from "@/lib/validations/product";
import type { ProductAttributeValueInput } from "@/lib/validations/category-attribute";
import { getStoreFeatures } from "@/lib/features";
import { validateAttributeValue, parseOptions } from "@/lib/attributes";
import { round3 } from "@/lib/sale-math";
import { variantSku } from "@/lib/variant-skus";
import { slugify } from "@/lib/utils";
import { Prisma } from "@/generated/prisma/client";
import { isForeignKeyConstraintError } from "@/lib/prisma-errors";
import type { ProductStatus } from "@/generated/prisma/enums";

/**
 * Margin as a percentage, clamped to what `Product.profitMargin` can hold
 * (`Decimal(6,2)`, so +/-9999.99). A cost above ~101x the price overflows that
 * column — e.g. selling 1.00 at a cost of 200.00 is -19900 — and Postgres
 * raises a numeric-overflow that is not P2002, so it escapes the catch below
 * and takes the whole form down. A typo should not do that.
 */
function computeProfitMargin(sellingPrice: number, fabricationPrice: number) {
  if (sellingPrice <= 0) return 0;
  const margin = ((sellingPrice - fabricationPrice) / sellingPrice) * 100;
  return Math.max(-9999.99, Math.min(9999.99, margin));
}

const requireProductEditor = requireStorePermission("product.create");

/**
 * Enforces the decimal-quantity policy for a product's stock and low-stock
 * threshold. Decimals are allowed only when the store has units_enabled AND the
 * product opts in; otherwise both must be whole numbers (unchanged behavior for
 * piece stores). Values are rounded to 3 decimals to match the DB columns.
 */
function resolveStockValues(
  unitsEnabled: boolean,
  allowDecimalQuantity: boolean,
  rawStock: number,
  rawMinimumStock: number
): { stock: number; minimumStock: number } | { error: string } {
  const allowDecimal = unitsEnabled && allowDecimalQuantity;
  if (!allowDecimal && (!Number.isInteger(rawStock) || !Number.isInteger(rawMinimumStock))) {
    return { error: "Stock and minimum stock must be whole numbers for this product." };
  }
  return { stock: round3(rawStock), minimumStock: round3(rawMinimumStock) };
}

/**
 * Validates the submitted attribute values against the selected category's
 * definitions (store-scoped). Values for definitions not on this category are
 * ignored; required definitions must have a value. Returns the normalised
 * definitionId→value map, or an error.
 */
async function resolveAttributeValues(
  storeId: string,
  categoryId: string,
  values: ProductAttributeValueInput[]
): Promise<{ resolved: Map<string, string> } | { error: string }> {
  if (!categoryId) return { resolved: new Map() };
  const defs = await prisma.categoryAttributeDefinition.findMany({
    where: { categoryId, storeId },
  });
  const byId = new Map(defs.map((d) => [d.id, d]));
  const resolved = new Map<string, string>();
  for (const { definitionId, value } of values) {
    const def = byId.get(definitionId);
    if (!def) continue; // not part of this category — ignore
    const check = validateAttributeValue(def.type, value, parseOptions(def.options), def.required);
    if (!check.ok) return { error: `${def.label}: ${check.error}` };
    resolved.set(definitionId, check.value);
  }
  for (const def of defs) {
    if (def.required && !(resolved.get(def.id) ?? "")) {
      return { error: `${def.label} is required.` };
    }
  }
  return { resolved };
}

/** Writes the resolved attribute values, removing stale/emptied ones. */
async function persistAttributeValues(
  productId: string,
  categoryId: string,
  storeId: string,
  resolved: Map<string, string>
) {
  if (!categoryId) {
    await prisma.productAttributeValue.deleteMany({ where: { productId } });
    return;
  }
  const defs = await prisma.categoryAttributeDefinition.findMany({
    where: { categoryId, storeId },
    select: { id: true },
  });
  const catDefIds = defs.map((d) => d.id);
  // Drop values whose definition no longer belongs to the product's category.
  await prisma.productAttributeValue.deleteMany({
    where: { productId, ...(catDefIds.length ? { definitionId: { notIn: catDefIds } } : {}) },
  });
  for (const [definitionId, value] of resolved) {
    if (!value) {
      await prisma.productAttributeValue.deleteMany({ where: { productId, definitionId } });
    } else {
      await prisma.productAttributeValue.upsert({
        where: { productId_definitionId: { productId, definitionId } },
        update: { value },
        create: { productId, definitionId, value },
      });
    }
  }
}

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

/**
 * Turns the colors picked on the creation form into one variant per color.
 * `Color` has no relation to `Product` — only to `ProductVariant` — so a
 * picked color has nowhere else to live, and generating the variants here is
 * what makes "pick 3 colors" produce a sellable product instead of a record
 * the user then has to open and fill in three more times.
 *
 * Every variant starts with zero stock: stock enters through the variant
 * section or a batch, never through the parent product's opening-stock field,
 * which is already zeroed for variant products.
 *
 * ponytail: colors only — size and any custom axis are still added one at a
 * time from the product's variant section. Extend to a full axis matrix when
 * users ask to pick sizes during creation too.
 */
/**
 * Materialise the sizes and colors picked on the create form as variants.
 *
 * Both are picked as vocabularies, so the result is their cross product: 3
 * colors x 4 sizes = 12 variants, one per combination, each with its own SKU
 * and its own stock. Picking only one axis gives one variant per value.
 * Pick order is preserved (first color = primary), which is the only thing
 * that records rank — nothing on ProductVariant stores it.
 */
async function createPickedVariants(
  storeId: string,
  productId: string,
  baseSku: string,
  sizeIds: string[],
  colorIds: string[]
) {
  // Drop duplicates, which a double-click on the same chip would otherwise send.
  const wantedSizes = [...new Set(sizeIds)];
  const wantedColors = [...new Set(colorIds)];
  if (wantedSizes.length === 0 && wantedColors.length === 0) return;

  const [sizes, colors] = await Promise.all([
    wantedSizes.length
      ? prisma.size.findMany({ where: { id: { in: wantedSizes }, storeId }, select: { id: true, name: true } })
      : Promise.resolve([]),
    wantedColors.length
      ? prisma.color.findMany({ where: { id: { in: wantedColors }, storeId }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const sizeById = new Map(sizes.map((x) => [x.id, x]));
  const colorById = new Map(colors.map((x) => [x.id, x]));

  // An id from another store is skipped rather than failing the whole save:
  // the product itself is already created at this point.
  const sizeAxis = wantedSizes.map((id) => sizeById.get(id)).filter((x) => x != null);
  const colorAxis = wantedColors.map((id) => colorById.get(id)).filter((x) => x != null);

  // A missing axis contributes a single null row, so the cross product below
  // degrades to "one variant per value of whichever axis was picked".
  const sizeRows = sizeAxis.length ? sizeAxis : [null];
  const colorRows = colorAxis.length ? colorAxis : [null];
  if (sizeRows[0] === null && colorRows[0] === null) return;

  // Store-wide, because @@unique([storeId, sku]) is store-wide.
  const existing = await prisma.productVariant.findMany({
    where: { storeId },
    select: { sku: true },
  });
  const taken = new Set(existing.map((v) => v.sku));

  const rows = sizeRows.flatMap((size) =>
    colorRows.map((color) => ({
      storeId,
      productId,
      sizeId: size?.id ?? null,
      colorId: color?.id ?? null,
      sku: variantSku(baseSku, [size?.name ?? "", color?.name ?? ""], taken),
      stock: 0,
    }))
  );

  if (rows.length > 0) await prisma.productVariant.createMany({ data: rows });
}

export async function createProduct(input: ProductInput) {
  const session = await requireProductEditor();
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid product data" };
  const data = parsed.data;

  const features = await getStoreFeatures(session.storeId);
  const stockResult = resolveStockValues(
    features.units_enabled,
    data.allowDecimalQuantity ?? false,
    data.stock,
    data.minimumStock
  );
  if ("error" in stockResult) return { error: stockResult.error };
  const { minimumStock } = stockResult;
  // A variant product sells only through its variants, so parent stock is
  // meaningless. The form hides the field when the switch is on but react-hook-
  // form keeps whatever was typed before the toggle, so a number can still
  // arrive here — and it would inflate the dashboard's "units in stock" and
  // leave a phantom IN movement in the ledger.
  const stock = data.hasVariants ? 0 : stockResult.stock;

  // Validate attribute values up-front (before creating the product).
  const attributesEnabled = features.category_attributes_enabled;
  const attrResult =
    attributesEnabled && data.attributes
      ? await resolveAttributeValues(session.storeId, data.categoryId || "", data.attributes)
      : { resolved: new Map<string, string>() };
  if ("error" in attrResult) return { error: attrResult.error };

  // A categoryId from another store (or a bogus one) would otherwise be written
  // straight through: resolveAttributeValues scopes by storeId and simply finds
  // no definitions, so it reports no error, and an unknown id surfaces as an
  // uncaught P2003. Every sibling action scopes this the same way.
  if (data.categoryId) {
    const category = await prisma.category.findFirst({
      where: { id: data.categoryId, storeId: session.storeId },
      select: { id: true },
    });
    if (!category) return { error: "Category not found" };
  }

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
        stock,
        minimumStock,
        status: data.status,
        hasVariants: data.hasVariants ?? false,
        unit: data.unit ?? "piece",
        allowDecimalQuantity: data.allowDecimalQuantity ?? false,
        createdById: session.userId,
        images: { create: data.images.map((url, position) => ({ url, position })) },
      },
    });

    if (stock > 0) {
      await prisma.inventoryMovement.create({
        data: {
          storeId: session.storeId,
          productId: product.id,
          type: "IN",
          quantity: stock,
          note: "Initial stock on product creation",
          createdById: session.userId,
        },
      });
    }

    if (attributesEnabled) {
      await persistAttributeValues(product.id, data.categoryId || "", session.storeId, attrResult.resolved);
    }

    // Colors are only meaningful on a variant product — on a simple one the
    // switch is off and the form sends none.
    if (data.hasVariants && (data.sizeIds?.length || data.colorIds?.length)) {
      await createPickedVariants(
        session.storeId,
        product.id,
        data.sku,
        data.sizeIds ?? [],
        data.colorIds ?? []
      );
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

  const features = await getStoreFeatures(session.storeId);
  const stockResult = resolveStockValues(
    features.units_enabled,
    data.allowDecimalQuantity ?? false,
    data.stock,
    data.minimumStock
  );
  if ("error" in stockResult) return { error: stockResult.error };
  const { minimumStock } = stockResult;
  const existingStock = Number(existing.stock);

  // For batch-tracked products the batch ledger owns on-hand stock, so the
  // form's number is ignored rather than rejected. It is a snapshot taken when
  // the page rendered, and any receive, adjustment or sale since then makes it
  // stale — which used to fail the save with a stock error even though the user
  // had only renamed the product. Receiving/adjustment stay the only write path.
  const stock = existing.trackBatch ? existingStock : stockResult.stock;

  const attributesEnabled = features.category_attributes_enabled;
  const attrResult =
    attributesEnabled && data.attributes
      ? await resolveAttributeValues(session.storeId, data.categoryId || "", data.attributes)
      : { resolved: new Map<string, string>() };
  if ("error" in attrResult) return { error: attrResult.error };

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
          stock,
          minimumStock,
          status: data.status,
          hasVariants: data.hasVariants ?? false,
          unit: data.unit ?? "piece",
          allowDecimalQuantity: data.allowDecimalQuantity ?? false,
        },
      });

      if (stock !== existingStock) {
        await tx.inventoryMovement.create({
          data: {
            storeId: session.storeId,
            productId: id,
            type: "ADJUSTMENT",
            quantity: round3(stock - existingStock),
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

    if (attributesEnabled) {
      await persistAttributeValues(id, data.categoryId || "", session.storeId, attrResult.resolved);
    }

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
