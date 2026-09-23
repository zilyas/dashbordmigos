/**
 * Scope vocabulary for the public `/api/v1` surface, in its own module so a
 * Client Component can import it without dragging `@/lib/prisma` (and the
 * Node-only driver) into the browser bundle via `@/lib/api/auth`.
 */
export const API_SCOPES = ["products:read", "stock:read", "orders:create"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** Plain-language labels for the create-key form. */
export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  "products:read": "Read the catalogue (products, prices, images)",
  "stock:read": "Read stock levels",
  "orders:create": "Place orders, which lowers stock",
};
