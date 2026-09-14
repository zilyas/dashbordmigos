import { describe, it, expect } from "vitest";
import {
  parseAxisValues,
  orderedAxisValues,
  axisValueList,
  validateAxisValues,
} from "@/lib/variant-axes";
import { variantLabel } from "@/lib/sale-math";

const AXES = [
  { key: "storage", label: "Storage" },
  { key: "color", label: "Colour" },
];

describe("parseAxisValues", () => {
  it("reads an object map of strings", () => {
    expect(parseAxisValues({ storage: "256GB", color: "Blue" })).toEqual({
      storage: "256GB",
      color: "Blue",
    });
  });
  it("coerces non-string values and ignores non-objects", () => {
    expect(parseAxisValues({ n: 12 })).toEqual({ n: "12" });
    expect(parseAxisValues(null)).toEqual({});
    expect(parseAxisValues(["a"])).toEqual({});
  });
});

describe("orderedAxisValues / axisValueList", () => {
  it("orders by the axis list and drops empty/unknown", () => {
    const values = { color: "Blue", storage: "256GB", junk: "x" };
    expect(orderedAxisValues(values, AXES)).toEqual([
      { key: "storage", label: "Storage", value: "256GB" },
      { key: "color", label: "Colour", value: "Blue" },
    ]);
    expect(axisValueList(values, AXES)).toEqual(["256GB", "Blue"]);
  });
  it("drops empties", () => {
    expect(axisValueList({ storage: "256GB", color: "  " }, AXES)).toEqual(["256GB"]);
  });
});

describe("validateAxisValues", () => {
  const allowed = new Set(["storage", "color"]);
  it("accepts known keys and cleans values", () => {
    const r = validateAxisValues({ storage: " 256GB ", color: "Blue" }, allowed);
    expect(r).toEqual({ ok: true, cleaned: { storage: "256GB", color: "Blue" } });
  });
  it("drops empty values", () => {
    const r = validateAxisValues({ storage: "256GB", color: "" }, allowed);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cleaned).toEqual({ storage: "256GB" });
  });
  it("rejects unknown axis keys", () => {
    const r = validateAxisValues({ voltage: "220V" }, allowed);
    expect(r.ok).toBe(false);
  });
});

describe("variantLabel with custom axes", () => {
  it("appends ordered axis values after size/color", () => {
    expect(variantLabel("M", "Noir", ["256GB", "Blue"])).toBe("M / Noir / 256GB / Blue");
    expect(variantLabel(null, null, ["256GB", "Blue"])).toBe("256GB / Blue");
  });
  it("is unchanged for size/color-only variants (flag off = no axis values)", () => {
    expect(variantLabel("M", "Noir")).toBe("M / Noir");
    expect(variantLabel("M", null)).toBe("M");
    expect(variantLabel(null, null)).toBeNull();
  });
});
