import { describe, it, expect } from "vitest";
import {
  CATALOG_TEMPLATES,
  TEMPLATE_KEYS,
  getCatalogTemplate,
  templateCategorySlug,
  templateAttributeKey,
  templateAxisKey,
  mergeFeatures,
  featuresNewlyEnabled,
} from "@/lib/catalog-templates";
import { DEFAULT_FEATURES, FEATURE_KEYS, type StoreFeatures } from "@/lib/features";

const dup = <T>(xs: T[]) => xs.length !== new Set(xs).size;

describe("catalog templates — structural invariants", () => {
  it("1. every template key is unique", () => {
    expect(dup(TEMPLATE_KEYS)).toBe(false);
    expect(TEMPLATE_KEYS.length).toBe(5);
  });

  it("2. category slugs are unique within each template", () => {
    for (const t of CATALOG_TEMPLATES) {
      const slugs = t.categories.map((c) => templateCategorySlug(c.name));
      expect(dup(slugs), `template ${t.key}`).toBe(false);
    }
  });

  it("3. attribute keys are unique within a category", () => {
    for (const t of CATALOG_TEMPLATES) {
      for (const c of t.categories) {
        const keys = (c.attributes ?? []).map((a) => templateAttributeKey(a.label));
        expect(dup(keys), `${t.key}/${c.name}`).toBe(false);
      }
    }
  });

  it("4. variant-axis keys are unique within a template", () => {
    for (const t of CATALOG_TEMPLATES) {
      const keys = (t.axes ?? []).map(templateAxisKey);
      expect(dup(keys), `template ${t.key}`).toBe(false);
    }
  });

  it("a template category's parent always refers to another category in the same template", () => {
    for (const t of CATALOG_TEMPLATES) {
      const names = new Set(t.categories.map((c) => c.name));
      for (const c of t.categories) {
        if (c.parent) expect(names.has(c.parent), `${t.key}/${c.name}`).toBe(true);
      }
    }
  });

  it("respects the real validation limits (SELECT has options, lengths, hex)", () => {
    for (const t of CATALOG_TEMPLATES) {
      for (const c of t.categories) {
        expect(c.name.length).toBeGreaterThanOrEqual(2);
        expect(c.name.length).toBeLessThanOrEqual(60);
        for (const a of c.attributes ?? []) {
          expect(a.label.length).toBeGreaterThanOrEqual(1);
          expect(a.label.length).toBeLessThanOrEqual(60);
          if (a.type === "SELECT") expect((a.options ?? []).length).toBeGreaterThan(0);
        }
      }
      for (const s of t.sizes ?? []) expect(s.length).toBeLessThanOrEqual(30);
      for (const c of t.colors ?? []) {
        expect(c.name.length).toBeLessThanOrEqual(30);
        if (c.hex) expect(c.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
      for (const label of t.axes ?? []) expect(label.length).toBeLessThanOrEqual(40);
    }
  });

  it("10. templates never include products, stock, sales, users or financial data", () => {
    const allowedTop = new Set([
      "key",
      "name",
      "description",
      "features",
      "categories",
      "axes",
      "sizes",
      "colors",
    ]);
    for (const t of CATALOG_TEMPLATES) {
      for (const k of Object.keys(t)) expect(allowedTop.has(k), `${t.key}.${k}`).toBe(true);
    }
    const forbidden = /"(product|stock|quantity|price|sellingPrice|fabricationPrice|sale|user|seller|invoice)"/i;
    expect(forbidden.test(JSON.stringify(CATALOG_TEMPLATES))).toBe(false);
  });

  it("only enables known feature flags", () => {
    for (const t of CATALOG_TEMPLATES) {
      for (const k of Object.keys(t.features)) {
        expect(FEATURE_KEYS as readonly string[]).toContain(k);
        expect(t.features[k as keyof StoreFeatures]).toBe(true);
      }
    }
  });
});

describe("getCatalogTemplate", () => {
  it("9. rejects unknown template keys", () => {
    expect(getCatalogTemplate("does-not-exist")).toBeUndefined();
    expect(getCatalogTemplate("")).toBeUndefined();
  });
  it("resolves every shipped key", () => {
    for (const k of TEMPLATE_KEYS) expect(getCatalogTemplate(k)?.key).toBe(k);
  });
});

describe("mergeFeatures / featuresNewlyEnabled", () => {
  it("6. preserves existing enabled flags unrelated to the template", () => {
    const current: StoreFeatures = { ...DEFAULT_FEATURES, expiry_batch_enabled: true };
    const merged = mergeFeatures(current, { units_enabled: true });
    expect(merged.expiry_batch_enabled).toBe(true); // untouched
    expect(merged.units_enabled).toBe(true); // enabled
  });

  it("7. enables required flags but never disables any", () => {
    const current: StoreFeatures = {
      ...DEFAULT_FEATURES,
      units_enabled: true,
      custom_variant_axes_enabled: true,
    };
    const merged = mergeFeatures(current, { category_attributes_enabled: true });
    // required flag turned on
    expect(merged.category_attributes_enabled).toBe(true);
    // nothing turned off
    for (const k of FEATURE_KEYS) {
      if (current[k]) expect(merged[k]).toBe(true);
    }
  });

  it("5. is idempotent — applying twice changes nothing the second time", () => {
    const template = getCatalogTemplate("grocery")!;
    const once = mergeFeatures(DEFAULT_FEATURES, template.features);
    const twice = mergeFeatures(once, template.features);
    expect(twice).toEqual(once);
    // second pass has no flags left to enable
    expect(featuresNewlyEnabled(once, template.features)).toEqual([]);
  });

  it("featuresNewlyEnabled reports only the flags that flip false→true", () => {
    const current: StoreFeatures = { ...DEFAULT_FEATURES, category_attributes_enabled: true };
    const template = getCatalogTemplate("grocery")!; // needs units + attrs + axes
    const newly = featuresNewlyEnabled(current, template.features);
    expect(newly).toContain("units_enabled");
    expect(newly).toContain("custom_variant_axes_enabled");
    expect(newly).not.toContain("category_attributes_enabled"); // already on
  });
});
