import "dotenv/config";
import { randomBytes } from "crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Role } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/security/password";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Same default email every environment has always used — changing it would
// make re-seeding an existing database silently create a second Super
// Admin instead of recognizing the one that's already there. Override via
// env var for a genuinely fresh deployment.
const SUPER_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? "superadmin@store.dev";
const SUPER_ADMIN_NAME = process.env.SEED_SUPER_ADMIN_NAME ?? "Platform Owner";

const SEED_DEMO = process.env.SEED_DEMO !== "false";
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Demo!2026Pass";

/** Guaranteed to satisfy the app's own password policy (length, upper, lower, digit, symbol). */
function generateSecurePassword(): string {
  const random = randomBytes(12).toString("base64").replace(/[+/=]/g, "").slice(0, 16);
  return `${random}!A1`;
}

async function seedSuperAdmin() {
  const existing = await prisma.user.findUnique({ where: { email: SUPER_ADMIN_EMAIL } });
  if (existing) {
    console.log(`Super Admin already exists: ${existing.email} (password left unchanged).`);
    return;
  }

  const suppliedPassword = process.env.SEED_SUPER_ADMIN_PASSWORD;
  const password = suppliedPassword ?? generateSecurePassword();
  const passwordHash = await hashPassword(password);

  const superAdmin = await prisma.user.create({
    data: {
      name: SUPER_ADMIN_NAME,
      email: SUPER_ADMIN_EMAIL,
      passwordHash,
      role: Role.SUPER_ADMIN,
      status: "ACTIVE",
    },
  });

  if (suppliedPassword) {
    console.log(`Super Admin created: ${superAdmin.email} (password set from SEED_SUPER_ADMIN_PASSWORD).`);
  } else {
    console.log("=".repeat(64));
    console.log(`Super Admin created: ${superAdmin.email}`);
    console.log(`One-time generated password: ${password}`);
    console.log("Save this now — it will not be shown again. Change it after first login.");
    console.log("=".repeat(64));
  }
}

/**
 * Idempotent demo data for exploring the multi-vertical / variant features.
 * Everything is namespaced under the "DEMO" store and demo emails, so it is
 * safe to run against a database that already holds real stores. Disable with
 * SEED_DEMO=false.
 */
async function seedDemo() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const DEMO_FEATURES = {
    units_enabled: true,
    category_attributes_enabled: true,
    custom_variant_axes_enabled: true,
  };
  const store = await prisma.store.upsert({
    where: { code: "DEMO" },
    // Enable units + category attributes so the demo shows both out of the box.
    update: { features: DEMO_FEATURES },
    create: {
      name: "Demo Boutique",
      code: "DEMO",
      currency: "MAD",
      taxRate: 20,
      features: DEMO_FEATURES,
    },
  });

  const manager = await prisma.user.upsert({
    where: { email: "manager@demo.store" },
    update: {},
    create: {
      name: "Demo Manager",
      email: "manager@demo.store",
      passwordHash,
      role: Role.MANAGER,
      status: "ACTIVE",
      storeId: store.id,
    },
  });

  await prisma.user.upsert({
    where: { email: "seller@demo.store" },
    update: {},
    create: {
      name: "Demo Seller",
      email: "seller@demo.store",
      passwordHash,
      role: Role.SELLER,
      status: "ACTIVE",
      storeId: store.id,
    },
  });

  // Sizes and colors (store-scoped vocabularies).
  const sizeNames = ["S", "M", "L", "XL"];
  const sizes = await Promise.all(
    sizeNames.map((name, i) =>
      prisma.size.upsert({
        where: { storeId_name: { storeId: store.id, name } },
        update: {},
        create: { storeId: store.id, name, position: i },
      })
    )
  );

  const colorSeeds = [
    { name: "Noir", hex: "#111111" },
    { name: "Blanc", hex: "#FFFFFF" },
    { name: "Rouge", hex: "#C0392B" },
    { name: "Bleu", hex: "#2E4A9E" },
  ];
  const colors = await Promise.all(
    colorSeeds.map((c, i) =>
      prisma.color.upsert({
        where: { storeId_name: { storeId: store.id, name: c.name } },
        update: {},
        create: { storeId: store.id, name: c.name, hex: c.hex, position: i },
      })
    )
  );

  // Clothing category (opts into variant support via metadata).
  const category = await prisma.category.upsert({
    where: { storeId_slug: { storeId: store.id, slug: "vetements" } },
    update: { metadata: { clothing: true } },
    create: {
      storeId: store.id,
      name: "Vêtements",
      slug: "vetements",
      isActive: true,
      metadata: { clothing: true },
    },
  });

  // Category attribute definitions (Phase 2) on the clothing category.
  const marqueDef = await prisma.categoryAttributeDefinition.upsert({
    where: { categoryId_key: { categoryId: category.id, key: "marque" } },
    update: {},
    create: {
      storeId: store.id,
      categoryId: category.id,
      key: "marque",
      label: "Marque",
      type: "TEXT",
      position: 0,
    },
  });
  const matiereDef = await prisma.categoryAttributeDefinition.upsert({
    where: { categoryId_key: { categoryId: category.id, key: "matiere" } },
    update: {},
    create: {
      storeId: store.id,
      categoryId: category.id,
      key: "matiere",
      label: "Matière",
      type: "SELECT",
      options: ["Coton", "Polyester", "Laine"],
      position: 1,
    },
  });

  // A variant-enabled product with a few individually-created variants.
  const product = await prisma.product.upsert({
    where: { storeId_sku: { storeId: store.id, sku: "DEMO-TSHIRT" } },
    update: { hasVariants: true },
    create: {
      storeId: store.id,
      sku: "DEMO-TSHIRT",
      name: "T-shirt Classique",
      slug: "t-shirt-classique",
      categoryId: category.id,
      fabricationPrice: 40,
      sellingPrice: 120,
      profitMargin: 66.67,
      stock: 0,
      minimumStock: 5,
      status: "ACTIVE",
      hasVariants: true,
      createdById: manager.id,
    },
  });

  // Custom variant axis (Phase 3) — a "Coupe" (fit) axis for the T-shirt.
  await prisma.variantAxisDefinition.upsert({
    where: { storeId_key: { storeId: store.id, key: "coupe" } },
    update: {},
    create: { storeId: store.id, key: "coupe", label: "Coupe", position: 0, isActive: true },
  });

  const sizeByName = Object.fromEntries(sizes.map((s) => [s.name, s.id]));
  const colorByName = Object.fromEntries(colors.map((c) => [c.name, c.id]));
  const demoVariants = [
    { size: "S", color: "Noir", sku: "DEMO-TSHIRT-S-NOIR", stock: 10, coupe: "Slim" },
    { size: "M", color: "Noir", sku: "DEMO-TSHIRT-M-NOIR", stock: 15, coupe: "Regular" },
    { size: "L", color: "Blanc", sku: "DEMO-TSHIRT-L-BLANC", stock: 8, coupe: "Regular" },
  ];
  for (const v of demoVariants) {
    await prisma.productVariant.upsert({
      where: { storeId_sku: { storeId: store.id, sku: v.sku } },
      update: { axisValues: { coupe: v.coupe } },
      create: {
        storeId: store.id,
        productId: product.id,
        sizeId: sizeByName[v.size],
        colorId: colorByName[v.color],
        sku: v.sku,
        stock: v.stock,
        isActive: true,
        axisValues: { coupe: v.coupe },
      },
    });
  }

  // A decimal (kg) product to demonstrate units + fractional quantities.
  await prisma.product.upsert({
    where: { storeId_sku: { storeId: store.id, sku: "DEMO-FLOUR" } },
    update: { unit: "kg", allowDecimalQuantity: true },
    create: {
      storeId: store.id,
      sku: "DEMO-FLOUR",
      name: "Farine (au kg)",
      slug: "farine-au-kg",
      fabricationPrice: 5,
      sellingPrice: 12,
      profitMargin: 58.33,
      stock: 25.5,
      minimumStock: 5,
      status: "ACTIVE",
      unit: "kg",
      allowDecimalQuantity: true,
      createdById: manager.id,
    },
  });

  // ── Cross-phase combined entity ──────────────────────────────────────────
  // ONE product exercising ALL extensions at once: decimal quantity (Phase 1b)
  // + Size/Color variants + custom "Coupe" axis (Phase 3) + category attribute
  // values (Phase 2). Used for cross-phase integration verification.
  const combo = await prisma.product.upsert({
    where: { storeId_sku: { storeId: store.id, sku: "DEMO-COMBO" } },
    update: { hasVariants: true, allowDecimalQuantity: true, unit: "kg", categoryId: category.id },
    create: {
      storeId: store.id,
      sku: "DEMO-COMBO",
      name: "Pull Combiné (au kg)",
      slug: "pull-combine",
      categoryId: category.id,
      fabricationPrice: 30,
      sellingPrice: 90,
      profitMargin: 66.67,
      stock: 0,
      minimumStock: 1,
      status: "ACTIVE",
      hasVariants: true,
      unit: "kg",
      allowDecimalQuantity: true,
      createdById: manager.id,
    },
  });

  // Category attribute values (Phase 2) for the combined product.
  await prisma.productAttributeValue.upsert({
    where: { productId_definitionId: { productId: combo.id, definitionId: marqueDef.id } },
    update: { value: "DemoBrand" },
    create: { productId: combo.id, definitionId: marqueDef.id, value: "DemoBrand" },
  });
  await prisma.productAttributeValue.upsert({
    where: { productId_definitionId: { productId: combo.id, definitionId: matiereDef.id } },
    update: { value: "Coton" },
    create: { productId: combo.id, definitionId: matiereDef.id, value: "Coton" },
  });

  // Variants: Size/Color + custom "Coupe" axis, with DECIMAL stock.
  const comboVariants = [
    { size: "S", color: "Noir", sku: "DEMO-COMBO-S-NOIR", stock: 5.5, coupe: "Slim" },
    { size: "M", color: "Blanc", sku: "DEMO-COMBO-M-BLANC", stock: 3.25, coupe: "Regular" },
  ];
  for (const v of comboVariants) {
    await prisma.productVariant.upsert({
      where: { storeId_sku: { storeId: store.id, sku: v.sku } },
      update: { axisValues: { coupe: v.coupe }, stock: v.stock },
      create: {
        storeId: store.id,
        productId: combo.id,
        sizeId: sizeByName[v.size],
        colorId: colorByName[v.color],
        sku: v.sku,
        stock: v.stock,
        isActive: true,
        axisValues: { coupe: v.coupe },
      },
    });
  }

  console.log("=".repeat(64));
  console.log("Demo data ready (store code DEMO):");
  console.log(`  Manager: manager@demo.store / ${DEMO_PASSWORD}`);
  console.log(`  Seller:  seller@demo.store / ${DEMO_PASSWORD}`);
  console.log("  Sizes: S, M, L, XL · Colors: Noir, Blanc, Rouge, Bleu");
  console.log("  Category: Vêtements (clothing) · Product: T-shirt Classique (3 variants)");
  console.log("  Units ENABLED · Decimal product: Farine (au kg) — sell e.g. 0.5 kg");
  console.log("  Category attributes ENABLED · Vêtements → Marque (text), Matière (select)");
  console.log("  Custom variant axes ENABLED · axis 'Coupe' on T-shirt variants (Slim/Regular)");
  console.log("  Cross-phase product: 'Pull Combiné (au kg)' — decimal + Size/Color + Coupe + attrs");
  console.log("=".repeat(64));
}

async function main() {
  console.log("Seeding database...");
  await seedSuperAdmin();
  if (SEED_DEMO) await seedDemo();
  else console.log("Skipping demo data (SEED_DEMO=false).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
