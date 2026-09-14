import { describe, it, expect } from "vitest";
import {
  sortBatchesFEFO,
  planBatchAllocation,
  planReturnRestoration,
  planDeletionRestoration,
  batchStockTotal,
  reconcileBatchStock,
  deriveBatchStatus,
  isBatchTrackingConfigurationValid,
  normalizeBatchQuantity,
  InvalidAllocationRequest,
  batchExpiryState,
  isBatchSellable,
  filterSellableBatches,
  validateExpiryTrackingActivation,
  planExpiryAwareAllocation,
  type BatchLike,
  type AllocationLike,
  type SellableBatch,
  type AllocatableBatch,
} from "@/lib/batches";

// Concise builder; receivedAt defaults spread so ties are explicit per-test.
function batch(id: string, opts: Partial<BatchLike> = {}): BatchLike {
  return {
    id,
    expiryDate: opts.expiryDate ?? null,
    receivedAt: opts.receivedAt ?? "2026-01-01T00:00:00.000Z",
    stock: opts.stock ?? 10,
  };
}

describe("compareBatchesFEFO / sortBatchesFEFO", () => {
  it("orders earlier expiry first", () => {
    const a = batch("a", { expiryDate: "2026-03-01" });
    const b = batch("b", { expiryDate: "2026-02-01" });
    expect(sortBatchesFEFO([a, b]).map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("places null-expiry batches after all dated batches (FEFO→FIFO)", () => {
    const dated = batch("dated", { expiryDate: "2026-12-31" });
    const undated = batch("undated", { expiryDate: null });
    expect(sortBatchesFEFO([undated, dated]).map((x) => x.id)).toEqual(["dated", "undated"]);
  });

  it("breaks ties by receivedAt ascending (FIFO) among undated batches", () => {
    const older = batch("older", { expiryDate: null, receivedAt: "2026-01-01" });
    const newer = batch("newer", { expiryDate: null, receivedAt: "2026-06-01" });
    expect(sortBatchesFEFO([newer, older]).map((x) => x.id)).toEqual(["older", "newer"]);
  });

  it("breaks full ties by stable id ordering (deterministic)", () => {
    const common = { expiryDate: "2026-05-05", receivedAt: "2026-01-01" };
    const b1 = batch("b1", common);
    const b2 = batch("b2", common);
    expect(sortBatchesFEFO([b2, b1]).map((x) => x.id)).toEqual(["b1", "b2"]);
  });

  it("does not mutate the input array", () => {
    const input = [batch("z", { expiryDate: "2026-09-09" }), batch("a", { expiryDate: "2026-01-01" })];
    const snapshot = input.map((b) => b.id);
    sortBatchesFEFO(input);
    expect(input.map((b) => b.id)).toEqual(snapshot);
  });
});

describe("planBatchAllocation", () => {
  it("allocates exactly from a single batch", () => {
    const plan = planBatchAllocation(4, [batch("a", { stock: 10 })]);
    expect(plan).toEqual({ ok: true, allocations: [{ batchId: "a", quantity: 4 }] });
  });

  it("splits across batches in FEFO order", () => {
    const plan = planBatchAllocation(12, [
      batch("later", { expiryDate: "2026-06-01", stock: 5 }),
      batch("soonest", { expiryDate: "2026-02-01", stock: 8 }),
    ]);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.allocations).toEqual([
        { batchId: "soonest", quantity: 8 },
        { batchId: "later", quantity: 4 },
      ]);
    }
  });

  it("is decimal-safe for quantities like 1.275", () => {
    const plan = planBatchAllocation(1.275, [batch("a", { stock: 1 }), batch("b", { stock: 5 })]);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      const sum = plan.allocations.reduce((s, x) => s + x.quantity, 0);
      expect(normalizeBatchQuantity(sum)).toBe(1.275);
      expect(plan.allocations[0]).toEqual({ batchId: "a", quantity: 1 });
      expect(plan.allocations[1]).toEqual({ batchId: "b", quantity: 0.275 });
    }
  });

  it("removes 0.001 binary-float noise across the split (0.1 + 0.2)", () => {
    const plan = planBatchAllocation(0.3, [batch("a", { stock: 0.1 }), batch("b", { stock: 0.2 })]);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      const sum = plan.allocations.reduce((s, x) => s + x.quantity, 0);
      expect(normalizeBatchQuantity(sum)).toBe(0.3);
    }
  });

  it("skips zero-stock and negative-stock batches", () => {
    const plan = planBatchAllocation(3, [
      batch("zero", { expiryDate: "2026-01-01", stock: 0 }),
      batch("neg", { expiryDate: "2026-01-02", stock: -5 }),
      batch("ok", { expiryDate: "2026-01-03", stock: 3 }),
    ]);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.allocations).toEqual([{ batchId: "ok", quantity: 3 }]);
  });

  it("reports insufficient total stock with the shortfall", () => {
    const plan = planBatchAllocation(10, [batch("a", { stock: 4 }), batch("b", { stock: 3 })]);
    expect(plan).toEqual({ ok: false, required: 10, available: 7, shortfall: 3 });
  });

  it("never allocates more than a source batch holds and the sum equals the request", () => {
    const batches = [
      batch("a", { expiryDate: "2026-02-01", stock: 2.5 }),
      batch("b", { expiryDate: "2026-03-01", stock: 2.5 }),
      batch("c", { expiryDate: "2026-04-01", stock: 2.5 }),
    ];
    const plan = planBatchAllocation(6, batches);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      for (const a of plan.allocations) {
        const src = batches.find((b) => b.id === a.batchId)!;
        expect(a.quantity).toBeLessThanOrEqual(Number(src.stock));
      }
      const sum = plan.allocations.reduce((s, x) => s + x.quantity, 0);
      expect(normalizeBatchQuantity(sum)).toBe(6);
    }
  });

  it("is deterministic for the same input", () => {
    const batches = [
      batch("a", { expiryDate: "2026-02-01", stock: 5 }),
      batch("b", { expiryDate: "2026-02-01", stock: 5 }),
    ];
    const p1 = planBatchAllocation(7, batches);
    const p2 = planBatchAllocation(7, batches);
    expect(p1).toEqual(p2);
  });

  it("does not mutate the input batches", () => {
    const batches = [batch("a", { stock: 5 }), batch("b", { stock: 5 })];
    const before = batches.map((b) => ({ ...b }));
    planBatchAllocation(7, batches);
    expect(batches).toEqual(before);
  });

  it("throws InvalidAllocationRequest for non-positive/non-finite requests", () => {
    expect(() => planBatchAllocation(0, [batch("a")])).toThrow(InvalidAllocationRequest);
    expect(() => planBatchAllocation(-1, [batch("a")])).toThrow(InvalidAllocationRequest);
    expect(() => planBatchAllocation(NaN, [batch("a")])).toThrow(InvalidAllocationRequest);
  });
});

describe("batchStockTotal / reconcileBatchStock", () => {
  it("sums batch stock at 3 decimals", () => {
    expect(batchStockTotal([batch("a", { stock: 0.1 }), batch("b", { stock: 0.2 })])).toBe(0.3);
  });

  it("reconciles equal aggregate and batch total", () => {
    const r = reconcileBatchStock(10, [batch("a", { stock: 6 }), batch("b", { stock: 4 })]);
    expect(r).toEqual({ aggregateStock: 10, batchTotal: 10, difference: 0, reconciled: true });
  });

  it("reports positive drift (aggregate ahead of batches)", () => {
    const r = reconcileBatchStock(12, [batch("a", { stock: 10 })]);
    expect(r.difference).toBe(2);
    expect(r.reconciled).toBe(false);
  });

  it("reports negative drift (batches ahead of aggregate)", () => {
    const r = reconcileBatchStock(8, [batch("a", { stock: 10 })]);
    expect(r.difference).toBe(-2);
    expect(r.reconciled).toBe(false);
  });

  it("treats sub-0.001 float noise as reconciled", () => {
    const r = reconcileBatchStock(0.3, [batch("a", { stock: 0.1 }), batch("b", { stock: 0.2 })]);
    expect(r.reconciled).toBe(true);
  });

  it("handles an empty batch list", () => {
    expect(batchStockTotal([])).toBe(0);
    expect(reconcileBatchStock(0, [])).toEqual({
      aggregateStock: 0,
      batchTotal: 0,
      difference: 0,
      reconciled: true,
    });
  });
});

describe("deriveBatchStatus", () => {
  it("keeps ARCHIVED sticky", () => {
    expect(deriveBatchStatus("ARCHIVED", 100)).toBe("ARCHIVED");
  });
  it("marks depleted when stock hits zero or below", () => {
    expect(deriveBatchStatus("ACTIVE", 0)).toBe("DEPLETED");
    expect(deriveBatchStatus("ACTIVE", -1)).toBe("DEPLETED");
  });
  it("revives a DEPLETED batch to ACTIVE when stock returns", () => {
    expect(deriveBatchStatus("DEPLETED", 5)).toBe("ACTIVE");
  });
  it("applies caller-supplied expiry only to still-stocked batches", () => {
    expect(deriveBatchStatus("ACTIVE", 5, true)).toBe("EXPIRED");
    expect(deriveBatchStatus("ACTIVE", 0, true)).toBe("DEPLETED"); // no stock wins
  });
});

function alloc(id: string, quantity: number, returnedQuantity = 0): AllocationLike {
  return { id, batchId: `batch-${id}`, quantity, returnedQuantity };
}

const TODAY = "2026-06-15";
function sb(over: Partial<SellableBatch> = {}): SellableBatch {
  return {
    status: over.status ?? "ACTIVE",
    stock: over.stock ?? 5,
    expiryDate: "expiryDate" in over ? over.expiryDate! : "2026-12-31",
  };
}

describe("batchExpiryState", () => {
  it("classifies valid / expires-today / expired / missing", () => {
    expect(batchExpiryState("2026-12-31", TODAY)).toBe("valid");
    expect(batchExpiryState("2026-06-15", TODAY)).toBe("expires_today");
    expect(batchExpiryState("2026-06-14", TODAY)).toBe("expired");
    expect(batchExpiryState(null, TODAY)).toBe("missing_date");
  });
});

describe("isBatchSellable / filterSellableBatches", () => {
  const opts = { trackExpiry: true, storeToday: TODAY };
  it("sells a dated active batch before expiry", () => {
    expect(isBatchSellable(sb({ expiryDate: "2026-07-01" }), opts)).toBe(true);
  });
  it("sells a batch expiring today", () => {
    expect(isBatchSellable(sb({ expiryDate: TODAY }), opts)).toBe(true);
  });
  it("does not sell an expired batch (by date, even if status stale ACTIVE)", () => {
    expect(isBatchSellable(sb({ expiryDate: "2026-06-14" }), opts)).toBe(false);
  });
  it("rejects a null date for a trackExpiry product", () => {
    expect(isBatchSellable(sb({ expiryDate: null }), opts)).toBe(false);
  });
  it("allows a null date for a batch-only product", () => {
    expect(isBatchSellable(sb({ expiryDate: null }), { trackExpiry: false, storeToday: TODAY })).toBe(true);
  });
  it("excludes EXPIRED / ARCHIVED / DEPLETED statuses", () => {
    expect(isBatchSellable(sb({ status: "EXPIRED" }), opts)).toBe(false);
    expect(isBatchSellable(sb({ status: "ARCHIVED" }), opts)).toBe(false);
    expect(isBatchSellable(sb({ status: "DEPLETED", stock: 0 }), opts)).toBe(false);
  });
  it("filters and preserves order (FEFO handled by the caller's sort)", () => {
    const list = [
      sb({ expiryDate: "2026-06-14" }), // expired
      sb({ expiryDate: "2026-06-20" }), // ok
      sb({ status: "ARCHIVED" }), // excluded
      sb({ expiryDate: TODAY }), // ok (today)
    ];
    const out = filterSellableBatches(list, opts);
    expect(out.map((b) => b.expiryDate)).toEqual(["2026-06-20", TODAY]);
  });
});

describe("validateExpiryTrackingActivation", () => {
  it("accepts a complete, valid, non-past assignment set", () => {
    const res = validateExpiryTrackingActivation(
      ["a", "b"],
      [{ batchId: "a", expiryDate: "2026-07-01" }, { batchId: "b", expiryDate: TODAY }],
      TODAY
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.dates.get("a")).toBe("2026-07-01");
  });
  it("requires every positive-stock batch to have a date", () => {
    const res = validateExpiryTrackingActivation(["a", "b"], [{ batchId: "a", expiryDate: "2026-07-01" }], TODAY);
    expect(res.ok).toBe(false);
  });
  it("rejects a foreign/unknown batch id", () => {
    const res = validateExpiryTrackingActivation(["a"], [{ batchId: "x", expiryDate: "2026-07-01" }], TODAY);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/foreign|unknown/i);
  });
  it("rejects duplicate batch assignments", () => {
    const res = validateExpiryTrackingActivation(
      ["a"],
      [{ batchId: "a", expiryDate: "2026-07-01" }, { batchId: "a", expiryDate: "2026-08-01" }],
      TODAY
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/duplicate/i);
  });
  it("rejects a past date", () => {
    const res = validateExpiryTrackingActivation(["a"], [{ batchId: "a", expiryDate: "2026-06-14" }], TODAY);
    expect(res.ok).toBe(false);
  });
});

describe("planReturnRestoration", () => {
  it("restores against the original allocations, oldest first", () => {
    const plan = planReturnRestoration(3, [alloc("a", 5, 0), alloc("b", 5, 0)]);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.restorations).toEqual([{ allocationId: "a", batchId: "batch-a", quantity: 3 }]);
  });

  it("splits a return across allocations respecting remaining owed", () => {
    const plan = planReturnRestoration(4, [alloc("a", 3, 1), alloc("b", 5, 0)]);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      // a owes 2, b owes 5 → take 2 from a then 2 from b
      expect(plan.restorations).toEqual([
        { allocationId: "a", batchId: "batch-a", quantity: 2 },
        { allocationId: "b", batchId: "batch-b", quantity: 2 },
      ]);
    }
  });

  it("supports fractional returns at 0.001", () => {
    const plan = planReturnRestoration(0.3, [alloc("a", 1.2, 0)]);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.restorations).toEqual([{ allocationId: "a", batchId: "batch-a", quantity: 0.3 }]);
  });

  it("fails when allocations can't cover the return (over-return guard)", () => {
    const plan = planReturnRestoration(5, [alloc("a", 3, 1)]); // only 2 owed
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe("insufficient_allocation");
  });

  it("reports missing allocation history", () => {
    const plan = planReturnRestoration(1, []);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe("missing_allocation");
  });

  it("does not mutate the allocations", () => {
    const allocs = [alloc("a", 5, 1)];
    const before = allocs.map((a) => ({ ...a }));
    planReturnRestoration(2, allocs);
    expect(allocs).toEqual(before);
  });
});

describe("planDeletionRestoration", () => {
  it("restores every allocation's outstanding units when they match the item", () => {
    const plan = planDeletionRestoration(4, [alloc("a", 3, 1), alloc("b", 2, 0)]); // outstanding 2 + 2 = 4
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.restorations).toEqual([
        { allocationId: "a", batchId: "batch-a", quantity: 2 },
        { allocationId: "b", batchId: "batch-b", quantity: 2 },
      ]);
    }
  });

  it("returns an empty plan when nothing is outstanding and allocations agree", () => {
    const plan = planDeletionRestoration(0, [alloc("a", 3, 3)]);
    expect(plan).toEqual({ ok: true, restorations: [] });
  });

  it("aborts when allocation history is missing for outstanding units", () => {
    const plan = planDeletionRestoration(2, []);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe("missing_allocation");
  });

  it("aborts when allocation outstanding total disagrees with the item", () => {
    const plan = planDeletionRestoration(5, [alloc("a", 3, 0)]); // allocations only cover 3
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe("allocation_outstanding_mismatch");
  });

  it("aborts when item is settled but an allocation still owes stock", () => {
    const plan = planDeletionRestoration(0, [alloc("a", 3, 1)]); // allocation owes 2 but item owes 0
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe("allocation_outstanding_mismatch");
  });
});

describe("planExpiryAwareAllocation (Phase 5 expired-sale override)", () => {
  const TODAY2 = "2026-06-15";
  function ab(id: string, over: Partial<AllocatableBatch> = {}): AllocatableBatch {
    return {
      id,
      status: over.status ?? "ACTIVE",
      stock: over.stock ?? 5,
      expiryDate: "expiryDate" in over ? over.expiryDate! : "2026-12-31",
      receivedAt: over.receivedAt ?? "2026-01-01",
    };
  }
  const opts = (allowExpired: boolean) => ({ trackExpiry: true, storeToday: TODAY2, allowExpired });

  it("batch-only product: plain FIFO, never flagged fromExpired", () => {
    const res = planExpiryAwareAllocation(6, [ab("a", { expiryDate: null, stock: 4 }), ab("b", { expiryDate: null, stock: 5 })], {
      trackExpiry: false,
      storeToday: TODAY2,
      allowExpired: false,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.allocations.every((a) => !a.fromExpired)).toBe(true);
  });

  it("17/19. default path uses only non-expired, never expired — even nearby", () => {
    const res = planExpiryAwareAllocation(3, [ab("fresh", { expiryDate: "2026-07-01", stock: 5 })], opts(false));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.allocations).toEqual([{ batchId: "fresh", quantity: 3, fromExpired: false }]);
  });

  it("23. when non-expired stock suffices, expired batches are untouched even with override on", () => {
    const res = planExpiryAwareAllocation(
      3,
      [ab("fresh", { expiryDate: "2026-07-01", stock: 5 }), ab("old", { expiryDate: "2026-06-14", status: "EXPIRED", stock: 9 })],
      opts(true)
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.allocations).toEqual([{ batchId: "fresh", quantity: 3, fromExpired: false }]);
      expect(res.allocations.some((a) => a.fromExpired)).toBe(false);
    }
  });

  it("19. MANAGER override draws non-expired first, then expired for the remainder", () => {
    const res = planExpiryAwareAllocation(
      7,
      [ab("fresh", { expiryDate: "2026-07-01", stock: 4 }), ab("old", { expiryDate: "2026-06-10", status: "EXPIRED", stock: 10 })],
      opts(true)
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.allocations).toEqual([
        { batchId: "fresh", quantity: 4, fromExpired: false },
        { batchId: "old", quantity: 3, fromExpired: true },
      ]);
    }
  });

  it("without override, insufficient non-expired stock fails (no expired fallback)", () => {
    const res = planExpiryAwareAllocation(
      7,
      [ab("fresh", { expiryDate: "2026-07-01", stock: 4 }), ab("old", { expiryDate: "2026-06-10", status: "EXPIRED", stock: 10 })],
      opts(false)
    );
    expect(res.ok).toBe(false);
  });

  it("20. override still excludes ARCHIVED and DEPLETED batches", () => {
    const res = planExpiryAwareAllocation(
      5,
      [
        ab("fresh", { expiryDate: "2026-07-01", stock: 1 }),
        ab("arch", { status: "ARCHIVED", expiryDate: "2026-06-10", stock: 50 }),
        ab("dep", { status: "DEPLETED", stock: 0, expiryDate: "2026-06-10" }),
      ],
      opts(true)
    );
    // only 1 non-expired + no eligible expired → cannot cover 5
    expect(res.ok).toBe(false);
  });

  it("21. override still fails when even expired stock is insufficient", () => {
    const res = planExpiryAwareAllocation(
      100,
      [ab("fresh", { expiryDate: "2026-07-01", stock: 4 }), ab("old", { expiryDate: "2026-06-10", status: "EXPIRED", stock: 10 })],
      opts(true)
    );
    expect(res.ok).toBe(false);
  });
});

describe("isBatchTrackingConfigurationValid", () => {
  it("rejects trackExpiry=true when trackBatch=false", () => {
    expect(isBatchTrackingConfigurationValid(false, true)).toBe(false);
  });
  it("accepts all other combinations, including the dormant default", () => {
    expect(isBatchTrackingConfigurationValid(false, false)).toBe(true); // dormant default
    expect(isBatchTrackingConfigurationValid(true, false)).toBe(true);
    expect(isBatchTrackingConfigurationValid(true, true)).toBe(true);
  });
});
