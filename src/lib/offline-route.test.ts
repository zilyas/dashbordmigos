import { describe, expect, it } from "vitest";
import { shouldNavigateToOfflineShell } from "./offline-route";

describe("shouldNavigateToOfflineShell", () => {
  it("stays put while online", () => {
    expect(shouldNavigateToOfflineShell("/dashboard", false)).toBe(false);
  });

  it("navigates off a server-rendered dashboard page when offline", () => {
    expect(shouldNavigateToOfflineShell("/dashboard", true)).toBe(true);
    expect(shouldNavigateToOfflineShell("/dashboard/sales/new", true)).toBe(true);
  });

  // The rule that protects a cashier's in-progress cart.
  it("never navigates away from the offline till", () => {
    expect(shouldNavigateToOfflineShell("/offline/pos", true)).toBe(false);
    expect(shouldNavigateToOfflineShell("/offline/pos/", true)).toBe(false);
  });

  it("never redirects /offline onto itself", () => {
    expect(shouldNavigateToOfflineShell("/offline", true)).toBe(false);
    expect(shouldNavigateToOfflineShell("/offline/", true)).toBe(false);
  });

  it("does not treat a lookalike path as the shell", () => {
    expect(shouldNavigateToOfflineShell("/offlinex", true)).toBe(true);
  });
});
