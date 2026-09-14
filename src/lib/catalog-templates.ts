/**
 * Store Starter Templates — typed application configuration (NOT a DB table).
 *
 * A template is an optional, additive catalog blueprint a Manager can apply to
 * their own store: it configures **catalog structure only** — feature flags,
 * categories (with an optional shallow parent tree), category attribute
 * definitions, optional custom variant axes, and optional standard sizes/colors.
 *
 * Templates never create products, stock, sales, users, or any financial data.
 *
 * This module is pure and client-safe (no Prisma / server imports) so the
 * preview UI can render it directly and the merge/planning helpers can be unit
 * tested. The stable slugs/keys derived here are what makes application
 * idempotent — the server action guards every write on them.
 */
import { slugify } from "@/lib/utils";
import type { AttributeType } from "@/lib/attributes";
import type { StoreFeatures } from "@/lib/features";

export type TemplateAttribute = {
  label: string;
  type: AttributeType;
  /** Required when `type === "SELECT"`. */
  options?: string[];
};

export type TemplateCategory = {
  name: string;
  description?: string;
  /** Parent category **name** within this same template, for a shallow tree. */
  parent?: string;
  /** Opts the category into the clothing/variant UI (Category.metadata). */
  isClothing?: boolean;
  attributes?: TemplateAttribute[];
};

export type TemplateColor = { name: string; hex?: string };

export type CatalogTemplate = {
  /** Stable key — never change once shipped (used in the audit log & URLs). */
  key: string;
  name: string;
  description: string;
  /** Feature flags this template needs. Only ever ENABLES flags (see mergeFeatures). */
  features: Partial<StoreFeatures>;
  categories: TemplateCategory[];
  /** Optional custom variant axes (needs custom_variant_axes_enabled). */
  axes?: string[];
  /** Optional standard sizes (built-in Size vocabulary). */
  sizes?: string[];
  /** Optional standard colors (built-in Color vocabulary). */
  colors?: TemplateColor[];
};

const COMMON_COLORS: TemplateColor[] = [
  { name: "Black", hex: "#000000" },
  { name: "White", hex: "#FFFFFF" },
  { name: "Grey", hex: "#808080" },
  { name: "Red", hex: "#FF0000" },
  { name: "Blue", hex: "#0000FF" },
  { name: "Green", hex: "#008000" },
];

export const CATALOG_TEMPLATES: CatalogTemplate[] = [
  {
    key: "general-retail",
    name: "General retail",
    description: "A minimal, vertical-neutral starting point for any shop.",
    features: {},
    categories: [
      { name: "General merchandise", description: "Everyday products." },
      { name: "Accessories", description: "Add-ons and small items." },
      { name: "Services", description: "Non-physical items and services." },
    ],
  },
  {
    key: "clothing",
    name: "Clothing",
    description: "Apparel and footwear with Size/Color variants and specs.",
    features: { category_attributes_enabled: true },
    categories: [
      {
        name: "Clothing",
        description: "Apparel of all kinds.",
        isClothing: true,
        attributes: [
          { label: "Brand", type: "TEXT" },
          { label: "Material", type: "TEXT" },
          { label: "Gender", type: "SELECT", options: ["Men", "Women", "Unisex", "Kids"] },
        ],
      },
      {
        name: "Shoes",
        description: "Footwear.",
        isClothing: true,
        attributes: [
          { label: "Brand", type: "TEXT" },
          { label: "Material", type: "TEXT" },
        ],
      },
      { name: "Accessories", description: "Bags, belts, hats and more." },
    ],
    // Size/Color are built-in axes, so no custom variant axis is needed.
    sizes: ["XS", "S", "M", "L", "XL"],
    colors: COMMON_COLORS,
  },
  {
    key: "grocery",
    name: "Grocery",
    description: "Food shops selling by weight/volume, with packaging specs.",
    features: {
      units_enabled: true,
      category_attributes_enabled: true,
      custom_variant_axes_enabled: true,
    },
    categories: [
      {
        name: "Food",
        description: "Fresh and packaged food.",
        attributes: [
          { label: "Brand", type: "TEXT" },
          { label: "Weight", type: "TEXT" },
          { label: "Origin", type: "TEXT" },
        ],
      },
      {
        name: "Beverages",
        description: "Drinks of all kinds.",
        attributes: [{ label: "Brand", type: "TEXT" }],
      },
      {
        name: "Household",
        description: "Cleaning and home essentials.",
        attributes: [{ label: "Brand", type: "TEXT" }],
      },
    ],
    axes: ["Pack Size"],
  },
  {
    key: "electronics",
    name: "Electronics",
    description: "Devices and accessories with model/warranty specs.",
    features: {
      category_attributes_enabled: true,
      custom_variant_axes_enabled: true,
    },
    categories: [
      {
        name: "Phones",
        description: "Smartphones and feature phones.",
        attributes: [
          { label: "Brand", type: "TEXT" },
          { label: "Model", type: "TEXT" },
          { label: "Warranty", type: "TEXT" },
        ],
      },
      {
        name: "Computers",
        description: "Laptops, desktops and tablets.",
        attributes: [
          { label: "Brand", type: "TEXT" },
          { label: "Model", type: "TEXT" },
          { label: "Warranty", type: "TEXT" },
          { label: "Voltage", type: "TEXT" },
        ],
      },
      {
        name: "Accessories",
        description: "Chargers, cables and peripherals.",
        attributes: [
          { label: "Brand", type: "TEXT" },
          { label: "Warranty", type: "TEXT" },
        ],
      },
    ],
    axes: ["Storage"],
  },
  {
    key: "cosmetics",
    name: "Cosmetics",
    description: "Beauty products with shade variants and skin-type specs.",
    features: {
      category_attributes_enabled: true,
      custom_variant_axes_enabled: true,
    },
    categories: [
      {
        name: "Skincare",
        description: "Creams, serums and cleansers.",
        attributes: [
          { label: "Brand", type: "TEXT" },
          { label: "Volume", type: "TEXT" },
          { label: "Skin Type", type: "SELECT", options: ["Normal", "Dry", "Oily", "Combination", "Sensitive"] },
        ],
      },
      {
        name: "Makeup",
        description: "Foundation, lipstick and more.",
        attributes: [
          { label: "Brand", type: "TEXT" },
          { label: "Volume", type: "TEXT" },
        ],
      },
      {
        name: "Fragrance",
        description: "Perfumes and body sprays.",
        attributes: [
          { label: "Brand", type: "TEXT" },
          { label: "Volume", type: "TEXT" },
        ],
      },
    ],
    axes: ["Shade"],
  },
];

export const TEMPLATE_KEYS = CATALOG_TEMPLATES.map((t) => t.key);

/** Look up a template by its stable key. Returns undefined for unknown keys. */
export function getCatalogTemplate(key: string): CatalogTemplate | undefined {
  return CATALOG_TEMPLATES.find((t) => t.key === key);
}

// ── Pure key derivation (must match the server-side CRUD actions) ────────────

export function templateCategorySlug(name: string): string {
  return slugify(name);
}
export function templateAttributeKey(label: string): string {
  return slugify(label) || "attribute";
}
export function templateAxisKey(label: string): string {
  return slugify(label) || "axis";
}

// ── Pure feature-flag merge ──────────────────────────────────────────────────

/**
 * Merge a template's required flags into a store's current flags. Only ever
 * turns flags ON — an existing enabled flag is never disabled, and unrelated
 * flags are preserved untouched.
 */
export function mergeFeatures(
  current: StoreFeatures,
  required: Partial<StoreFeatures>
): StoreFeatures {
  const next = { ...current };
  for (const key of Object.keys(required) as (keyof StoreFeatures)[]) {
    if (required[key] === true) next[key] = true;
  }
  return next;
}

/** The flag keys a template would newly enable given the store's current flags. */
export function featuresNewlyEnabled(
  current: StoreFeatures,
  required: Partial<StoreFeatures>
): (keyof StoreFeatures)[] {
  return (Object.keys(required) as (keyof StoreFeatures)[]).filter(
    (key) => required[key] === true && current[key] !== true
  );
}
