import { describe, it, expect } from "vitest";
import {
  classifyExpiry,
  notificationThresholdFor,
  expiryDedupeKey,
  AT_RISK_BUCKETS,
  type ExpiryBucket,
} from "@/lib/expiry";

describe("classifyExpiry buckets", () => {
  it("1. expired for negative days", () => expect(classifyExpiry(-1)).toBe("expired"));
  it("2. today for zero days", () => expect(classifyExpiry(0)).toBe("today"));
  it("3. 1–7 days", () => {
    expect(classifyExpiry(1)).toBe("7");
    expect(classifyExpiry(7)).toBe("7");
  });
  it("4. 8–30 days", () => {
    expect(classifyExpiry(8)).toBe("30");
    expect(classifyExpiry(30)).toBe("30");
  });
  it("5. 31–60 days", () => {
    expect(classifyExpiry(31)).toBe("60");
    expect(classifyExpiry(60)).toBe("60");
  });
  it("6. later beyond 60", () => expect(classifyExpiry(61)).toBe("later"));
  it("7. missing date", () => expect(classifyExpiry(null)).toBe("missing"));

  it("8. buckets never overlap across a wide day range", () => {
    for (let d = -5; d <= 120; d++) {
      const buckets = (["expired", "today", "7", "30", "60", "later"] as ExpiryBucket[]).filter(
        (b) => classifyExpiry(d) === b
      );
      expect(buckets.length).toBe(1); // exactly one bucket per day
    }
    expect(AT_RISK_BUCKETS).not.toContain("later");
    expect(AT_RISK_BUCKETS).not.toContain("missing");
  });
});

describe("notificationThresholdFor", () => {
  it("17. expired has highest priority", () => expect(notificationThresholdFor(-3)).toBe("expired"));
  it("18. today threshold", () => expect(notificationThresholdFor(0)).toBe("today"));
  it("19. seven-day threshold", () => {
    expect(notificationThresholdFor(1)).toBe("7");
    expect(notificationThresholdFor(7)).toBe("7");
  });
  it("20. thirty-day threshold", () => {
    expect(notificationThresholdFor(8)).toBe("30");
    expect(notificationThresholdFor(30)).toBe("30");
  });
  it("21. no notification beyond 30 days or missing date", () => {
    expect(notificationThresholdFor(31)).toBeNull();
    expect(notificationThresholdFor(60)).toBeNull();
    expect(notificationThresholdFor(null)).toBeNull();
  });
  it("16. a late sweep fires only the CURRENT (most urgent) threshold", () => {
    // A batch now 2 days out fires "7", not also "30" — one threshold per call.
    expect(notificationThresholdFor(2)).toBe("7");
  });
});

describe("expiryDedupeKey", () => {
  it("22. is stable for the same batch/date/threshold", () => {
    expect(expiryDedupeKey("b1", "2026-06-30", "7")).toBe("expiry:b1:2026-06-30:7");
    expect(expiryDedupeKey("b1", "2026-06-30", "7")).toBe(expiryDedupeKey("b1", "2026-06-30", "7"));
  });
  it("23. changes when the expiry date is corrected", () => {
    expect(expiryDedupeKey("b1", "2026-06-30", "7")).not.toBe(expiryDedupeKey("b1", "2026-07-15", "7"));
  });
  it("differs per threshold so escalation isn't suppressed", () => {
    expect(expiryDedupeKey("b1", "2026-06-30", "today")).not.toBe(expiryDedupeKey("b1", "2026-06-30", "7"));
  });
});
