import { describe, expect, it } from "vitest";
import type { SyncSummary } from "@/lib/offline/sync";
import { pendingCount, saleBadge, saleLabel, syncFeedback } from "./offline-home";

const summary = (over: Partial<SyncSummary> = {}): SyncSummary => ({
  ran: true,
  uploaded: 0,
  replayed: 0,
  review: 0,
  retry: 0,
  pruned: 0,
  stopped: null,
  ...over,
});

describe("saleBadge", () => {
  it("keeps review distinct from pending", () => {
    expect(saleBadge("pending").label).toBe("Pending Sync");
    expect(saleBadge("synced").label).toBe("Synced");
    expect(saleBadge("review").label).toBe("Needs Review");
  });
});

describe("syncFeedback", () => {
  it("never claims success when the run was stopped", () => {
    const stopped = syncFeedback(summary({ stopped: "offline", message: "The server is not reachable." }));
    expect(stopped.tone).toBe("error");
    expect(stopped.text).toBe("The server is not reachable.");
    // Stopped without a message must still read as a failure, not silence.
    expect(syncFeedback(summary({ stopped: "signed_out" })).tone).toBe("error");
  });

  it("reports a busy lock rather than a result it does not have", () => {
    expect(syncFeedback(summary({ ran: false })).tone).toBe("warn");
  });

  it("counts replayed sales as sent and warns on review or retry", () => {
    expect(syncFeedback(summary({ uploaded: 1, replayed: 2 })).text).toBe("3 sales sent.");
    expect(syncFeedback(summary({ uploaded: 1 })).text).toBe("1 sale sent.");
    const mixed = syncFeedback(summary({ uploaded: 1, review: 1, retry: 2 }));
    expect(mixed.tone).toBe("warn");
    expect(mixed.text).toBe("1 sale sent, 1 need review, 2 will retry.");
    expect(syncFeedback(summary()).text).toBe("Everything is already synced.");
  });
});

describe("pendingCount", () => {
  it("counts everything the server does not have yet", () => {
    const rows = [
      { state: "pending" as const },
      { state: "review" as const },
      { state: "synced" as const },
    ];
    expect(pendingCount(rows as never)).toBe(2);
  });
});

describe("saleLabel", () => {
  it("prefers the invoice number and falls back to a short queued id", () => {
    expect(saleLabel({ invoiceNumber: "INV-7", clientSaleId: "abcdefghij" })).toBe("INV-7");
    expect(saleLabel({ invoiceNumber: null, clientSaleId: "abcdefghij" })).toBe("Queued · abcdefgh");
    expect(saleLabel({ invoiceNumber: null })).toBe("Queued sale");
  });
});
