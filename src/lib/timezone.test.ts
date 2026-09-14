import { describe, it, expect } from "vitest";
import {
  isValidIanaTimezone,
  getDateKeyInTimezone,
  getTodayInTimezone,
  toDateKey,
  compareDateOnly,
  isExpiredOnDate,
  daysUntilExpiry,
} from "@/lib/timezone";

describe("isValidIanaTimezone", () => {
  it("accepts real IANA zones", () => {
    for (const tz of ["UTC", "Africa/Casablanca", "Europe/Paris", "America/New_York", "Asia/Tokyo"]) {
      expect(isValidIanaTimezone(tz)).toBe(true);
    }
  });
  it("rejects invalid values and fixed offsets", () => {
    expect(isValidIanaTimezone("Not/AZone")).toBe(false);
    expect(isValidIanaTimezone("+01:00")).toBe(false);
    expect(isValidIanaTimezone("")).toBe(false);
    // @ts-expect-error runtime guard for non-strings
    expect(isValidIanaTimezone(null)).toBe(false);
  });
});

describe("getDateKeyInTimezone / getTodayInTimezone", () => {
  it("resolves the store-local date differing from UTC near midnight", () => {
    // 02:30 UTC is still the previous day in New York.
    const d = new Date("2026-03-15T02:30:00.000Z");
    expect(getDateKeyInTimezone(d, "UTC")).toBe("2026-03-15");
    expect(getDateKeyInTimezone(d, "America/New_York")).toBe("2026-03-14");
    // 20:00 UTC is already the next day in Tokyo.
    const d2 = new Date("2026-03-15T20:00:00.000Z");
    expect(getDateKeyInTimezone(d2, "Asia/Tokyo")).toBe("2026-03-16");
  });
  it("uses the injected now", () => {
    expect(getTodayInTimezone("UTC", new Date("2026-07-04T12:00:00.000Z"))).toBe("2026-07-04");
  });
  it("throws on an invalid timezone rather than silently using the server zone", () => {
    expect(() => getDateKeyInTimezone(new Date(), "Bogus/Zone")).toThrow();
  });
});

describe("toDateKey — date-only values don't shift", () => {
  it("reads a @db.Date (UTC-midnight) as its stored calendar date", () => {
    expect(toDateKey(new Date("2026-06-01T00:00:00.000Z"))).toBe("2026-06-01");
    expect(toDateKey(new Date("2026-12-31T00:00:00.000Z"))).toBe("2026-12-31");
  });
  it("passes through a string date key", () => {
    expect(toDateKey("2026-06-01")).toBe("2026-06-01");
  });
});

describe("compareDateOnly", () => {
  it("orders date-only values", () => {
    expect(compareDateOnly("2026-01-01", "2026-02-01")).toBe(-1);
    expect(compareDateOnly("2026-02-01", "2026-01-01")).toBe(1);
    expect(compareDateOnly("2026-01-01", "2026-01-01")).toBe(0);
  });
});

describe("isExpiredOnDate", () => {
  it("is expired the day AFTER the expiry date", () => {
    expect(isExpiredOnDate("2026-06-01", "2026-06-02")).toBe(true); // expired yesterday
  });
  it("is NOT expired on the expiry date itself (sellable all day)", () => {
    expect(isExpiredOnDate("2026-06-01", "2026-06-01")).toBe(false); // expires today
  });
  it("is NOT expired before the expiry date", () => {
    expect(isExpiredOnDate("2026-06-02", "2026-06-01")).toBe(false); // expires tomorrow
  });
});

describe("daysUntilExpiry", () => {
  it("counts forward, zero today, negative past", () => {
    expect(daysUntilExpiry("2026-06-03", "2026-06-01")).toBe(2);
    expect(daysUntilExpiry("2026-06-01", "2026-06-01")).toBe(0);
    expect(daysUntilExpiry("2026-05-30", "2026-06-01")).toBe(-2);
  });
  it("handles month and year boundaries", () => {
    expect(daysUntilExpiry("2026-03-01", "2026-02-28")).toBe(1); // 2026 not leap
    expect(daysUntilExpiry("2027-01-01", "2026-12-31")).toBe(1);
  });
});
