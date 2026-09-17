import { describe, expect, it } from "vitest";

import { productSchema } from "./product";

const base = {
  name: "Rice",
  sku: "RICE-1",
  fabricationPrice: 5,
  sellingPrice: 10,
  stock: 0,
  minimumStock: 0,
  status: "ACTIVE" as const,
  images: [],
};

describe("productSchema", () => {
  it("trims the name and SKU so whitespace cannot pass the minimum length", () => {
    expect(productSchema.safeParse({ ...base, name: "  " }).success).toBe(false);
    const parsed = productSchema.parse({ ...base, sku: " RICE-1 " });
    // Untrimmed, "RICE-1 " and "RICE-1" would be two rows under @@unique([storeId, sku]).
    expect(parsed.sku).toBe("RICE-1");
  });

  it("rejects prices beyond what Decimal(10,2) can hold", () => {
    expect(productSchema.safeParse({ ...base, sellingPrice: 1e30 }).success).toBe(false);
    expect(productSchema.safeParse({ ...base, fabricationPrice: 1e30 }).success).toBe(false);
    expect(productSchema.safeParse({ ...base, sellingPrice: 99999999.99 }).success).toBe(true);
  });

  it("rejects stock beyond what Decimal(12,3) can hold", () => {
    expect(productSchema.safeParse({ ...base, stock: 1e30 }).success).toBe(false);
    expect(productSchema.safeParse({ ...base, minimumStock: 1e30 }).success).toBe(false);
  });

  it("still rejects negative prices and stock", () => {
    expect(productSchema.safeParse({ ...base, sellingPrice: -1 }).success).toBe(false);
    expect(productSchema.safeParse({ ...base, stock: -1 }).success).toBe(false);
  });
});
