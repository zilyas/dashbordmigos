"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireStorePermission } from "@/lib/rbac-guards";
import { logActivity } from "@/lib/audit";
import { parseFeatures } from "@/lib/features";
import {
  getCatalogTemplate,
  templateCategorySlug,
  templateAttributeKey,
  templateAxisKey,
  mergeFeatures,
  featuresNewlyEnabled,
} from "@/lib/catalog-templates";
import { Prisma } from "@/generated/prisma/client";

// Templates configure catalog structure, so they reuse the same "catalog
// manager" gate as categories/attributes/axes/sizes/colors. This resolves the
// acting store from the session (never from client input) and only admits a
// MANAGER with a store — a SUPER_ADMIN has no storeId and is rejected here,
// preserving tenant isolation.
const requireCatalogManager = requireStorePermission("category.manage");

type Counts = {
  categories: number;
  attributes: number;
  axes: number;
  sizes: number;
  colors: number;
};

const zeroCounts = (): Counts => ({ categories: 0, attributes: 0, axes: 0, sizes: 0, colors: 0 });

export type ApplyTemplateResult = {
  templateKey: string;
  templateName: string;
  created: Counts;
  reused: Counts;
  featuresEnabled: string[];
};

/**
 * Apply a starter catalog template to the acting Manager's own store.
 *
 * Additive · idempotent · non-destructive · transactional. Every write is
 * guarded on a stable slug/key, so an existing record is reused (reported as
 * "reused") rather than overwritten, and running twice is a no-op. Feature
 * flags are only ever enabled — never silently disabled — and unrelated flags
 * are preserved.
 */
export async function applyCatalogTemplate(templateKey: string) {
  const session = await requireCatalogManager();
  const { storeId, userId } = session;

  const template = getCatalogTemplate(templateKey);
  if (!template) return { error: "Unknown template." };

  const created = zeroCounts();
  const reused = zeroCounts();

  const featuresEnabled = await prisma.$transaction(async (tx) => {
    // ── Feature flags: enable only what the template needs, preserve the rest ──
    const store = await tx.store.findUniqueOrThrow({
      where: { id: storeId },
      select: { features: true },
    });
    const current = parseFeatures(store.features);
    const enabledKeys = featuresNewlyEnabled(current, template.features);
    if (enabledKeys.length > 0) {
      await tx.store.update({
        where: { id: storeId },
        data: { features: mergeFeatures(current, template.features) as Prisma.InputJsonObject },
      });
    }

    // ── Categories (parents first) + their attribute definitions ──────────────
    const categoryIdByName = new Map<string, string>();
    // Order so a parent is always created/resolved before its children.
    const ordered = [...template.categories].sort(
      (a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0)
    );

    for (const cat of ordered) {
      const slug = templateCategorySlug(cat.name);
      // Reuse on either unique constraint ([storeId,name] or [storeId,slug]).
      let record = await tx.category.findFirst({
        where: { storeId, OR: [{ slug }, { name: cat.name }] },
        select: { id: true },
      });
      if (record) {
        reused.categories += 1;
      } else {
        const parentId = cat.parent ? categoryIdByName.get(cat.parent) ?? null : null;
        record = await tx.category.create({
          data: {
            storeId,
            name: cat.name,
            slug,
            description: cat.description ?? null,
            isActive: true,
            parentId,
            metadata: cat.isClothing ? { clothing: true } : Prisma.JsonNull,
          },
          select: { id: true },
        });
        created.categories += 1;
      }
      categoryIdByName.set(cat.name, record.id);

      // Attribute definitions are additive per category (template attrs are
      // never `required`, so adding one can't invalidate existing products).
      for (const attr of cat.attributes ?? []) {
        const key = templateAttributeKey(attr.label);
        const existing = await tx.categoryAttributeDefinition.findUnique({
          where: { categoryId_key: { categoryId: record.id, key } },
          select: { id: true },
        });
        if (existing) {
          reused.attributes += 1;
        } else {
          await tx.categoryAttributeDefinition.create({
            data: {
              storeId,
              categoryId: record.id,
              key,
              label: attr.label,
              type: attr.type,
              options: attr.type === "SELECT" ? (attr.options ?? []) : Prisma.JsonNull,
              required: false,
              position: 0,
            },
          });
          created.attributes += 1;
        }
      }
    }

    // ── Custom variant axes ───────────────────────────────────────────────────
    for (const label of template.axes ?? []) {
      const key = templateAxisKey(label);
      const existing = await tx.variantAxisDefinition.findUnique({
        where: { storeId_key: { storeId, key } },
        select: { id: true },
      });
      if (existing) {
        reused.axes += 1;
      } else {
        await tx.variantAxisDefinition.create({
          data: { storeId, key, label, position: 0, isActive: true },
        });
        created.axes += 1;
      }
    }

    // ── Sizes ─────────────────────────────────────────────────────────────────
    for (const name of template.sizes ?? []) {
      const existing = await tx.size.findUnique({
        where: { storeId_name: { storeId, name } },
        select: { id: true },
      });
      if (existing) {
        reused.sizes += 1;
      } else {
        await tx.size.create({ data: { storeId, name, position: 0 } });
        created.sizes += 1;
      }
    }

    // ── Colors ────────────────────────────────────────────────────────────────
    for (const color of template.colors ?? []) {
      const existing = await tx.color.findUnique({
        where: { storeId_name: { storeId, name: color.name } },
        select: { id: true },
      });
      if (existing) {
        reused.colors += 1;
      } else {
        await tx.color.create({
          data: { storeId, name: color.name, hex: color.hex ?? null, position: 0 },
        });
        created.colors += 1;
      }
    }

    await logActivity(
      {
        storeId,
        userId,
        action: "catalog.templateApplied",
        entity: "Store",
        entityId: storeId,
        metadata: { templateKey: template.key, created, reused, featuresEnabled: enabledKeys },
      },
      tx
    );

    return enabledKeys;
  });

  revalidatePath("/settings");
  revalidatePath("/categories");
  revalidatePath("/products");
  revalidatePath("/sizes");
  revalidatePath("/colors");
  revalidatePath("/variant-axes");

  const result: ApplyTemplateResult = {
    templateKey: template.key,
    templateName: template.name,
    created,
    reused,
    featuresEnabled: featuresEnabled,
  };
  return { success: true as const, result };
}
