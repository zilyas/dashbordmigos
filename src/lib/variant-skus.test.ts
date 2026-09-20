import { describe, expect, it } from "vitest";
import { variantSku } from "@/lib/variant-skus";

describe("variantSku", () => {
  it("appends one slugified label", () => {
    expect(variantSku("TSHIRT", ["Navy Blue"], new Set())).toBe("TSHIRT-NAVY-BLUE");
  });

  it("joins size and color in display order", () => {
    expect(variantSku("TSHIRT", ["M", "Navy Blue"], new Set())).toBe("TSHIRT-M-NAVY-BLUE");
  });

  it("disambiguates labels that slugify identically", () => {
    const taken = new Set<string>();
    expect(variantSku("T", ["Blue"], taken)).toBe("T-BLUE");
    expect(variantSku("T", ["blue"], taken)).toBe("T-BLUE-2");
  });

  it("avoids SKUs already used by existing variants", () => {
    expect(variantSku("T", ["Red"], new Set(["T-RED"]))).toBe("T-RED-2");
  });

  it("never exceeds the 40-character schema cap and keeps the labels", () => {
    const sku = variantSku("X".repeat(60), ["XL", "Green"], new Set());
    expect(sku.length).toBeLessThanOrEqual(40);
    expect(sku.endsWith("-XL-GREEN")).toBe(true);
  });

  it("falls back to VAR when no label has usable characters", () => {
    expect(variantSku("T", ["///"], new Set())).toBe("T-VAR");
  });

  it("drops empty parts so a size-only pick has no trailing dash", () => {
    expect(variantSku("T", ["L", ""], new Set())).toBe("T-L");
  });
});
