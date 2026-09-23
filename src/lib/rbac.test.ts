import { describe, it, expect } from "vitest";
import { isRouteAllowed, can } from "./rbac";

// isRouteAllowed falls through to *allow* when no rule matches a path, so every
// manager-only screen needs its rule pinned here. A missing rule is silent.
describe("isRouteAllowed", () => {
  it("keeps a seller out of the storefront API screen", () => {
    expect(isRouteAllowed("/integrations", "SELLER")).toBe(false);
  });

  it("keeps the platform owner out too, since the keys belong to a store", () => {
    expect(isRouteAllowed("/integrations", "SUPER_ADMIN")).toBe(false);
  });

  it("lets the store manager in", () => {
    expect(isRouteAllowed("/integrations", "MANAGER")).toBe(true);
  });
});

describe("apiClient.manage", () => {
  it("belongs to the manager alone: a key must be attributed to a user inside the store", () => {
    expect(can("MANAGER", "apiClient.manage")).toBe(true);
    expect(can("SELLER", "apiClient.manage")).toBe(false);
    expect(can("SUPER_ADMIN", "apiClient.manage")).toBe(false);
  });
});
