import { describe, expect, it } from "vitest";
import { colorVariantSku } from "@/lib/color-variants";

describe("colorVariantSku", () => {
  it("appends the slugified color", () => {
    expect(colorVariantSku("TSHIRT", "Navy Blue", new Set())).toBe("TSHIRT-NAVY-BLUE");
  });

  it("disambiguates colors that slugify identically", () => {
    const taken = new Set<string>();
    expect(colorVariantSku("T", "Blue", taken)).toBe("T-BLUE");
    expect(colorVariantSku("T", "blue", taken)).toBe("T-BLUE-2");
  });

  it("avoids SKUs already used by existing variants", () => {
    expect(colorVariantSku("T", "Red", new Set(["T-RED"]))).toBe("T-RED-2");
  });

  it("never exceeds the 40-character schema cap and keeps the color", () => {
    const sku = colorVariantSku("X".repeat(60), "Green", new Set());
    expect(sku.length).toBeLessThanOrEqual(40);
    expect(sku.endsWith("-GREEN")).toBe(true);
  });

  it("falls back to COLOR when the name has no usable characters", () => {
    expect(colorVariantSku("T", "///", new Set())).toBe("T-COLOR");
  });
});
