import { describe, expect, it, vi } from "vitest";
import { decrementVariantStock, incrementVariantStock } from "@/lib/inventory";

function makeTx(updateManyCount: number) {
  return {
    productVariant: {
      updateMany: vi.fn().mockResolvedValue({ count: updateManyCount }),
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    product: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("decrementVariantStock", () => {
  it("bumps the parent product's updatedAt when stock is deducted", async () => {
    const tx = makeTx(1);
    const ok = await decrementVariantStock(tx, "variant-1", 2);
    expect(ok).toBe(true);
    expect(tx.product.updateMany).toHaveBeenCalledTimes(1);
    const call = tx.product.updateMany.mock.calls[0][0];
    expect(call.data.updatedAt).toBeInstanceOf(Date);
  });

  it("does not touch the parent product when stock is insufficient", async () => {
    const tx = makeTx(0);
    const ok = await decrementVariantStock(tx, "variant-1", 2);
    expect(ok).toBe(false);
    expect(tx.product.updateMany).not.toHaveBeenCalled();
  });
});

describe("incrementVariantStock", () => {
  it("bumps the parent product's updatedAt on restore", async () => {
    const tx = makeTx(1);
    await incrementVariantStock(tx, "variant-1", 2);
    expect(tx.product.updateMany).toHaveBeenCalledTimes(1);
    const call = tx.product.updateMany.mock.calls[0][0];
    expect(call.data.updatedAt).toBeInstanceOf(Date);
  });
});
