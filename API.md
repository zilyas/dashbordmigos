# Storefront Inventory API (v1)

One central inventory, many e-commerce sites. Every connected storefront reads
the same stock numbers and writes orders back to the same ledger, so a sale on
any site decrements the store's quantity immediately and the other sites see it
on their next poll.

Base URL: `https://<your-host>/api/v1`

## The store must be activated first

The API answers for a store only after the platform owner switches it on:
**Stores > Edit > Advanced features > Storefront API**. The switch is off for
every store until the owner ticks it.

A key for a store that is not activated is authenticated correctly and then
refused with `403 api_not_enabled`. Switching the flag off stops the very next
request — the decision is re-read from the database on every call and is never
cached. A store manager cannot grant this to their own store.

## Authentication

Every request carries a machine key:

```
Authorization: Bearer sk_<prefix>_<secret>
```

A key belongs to exactly one store. The store is read from the key, never from
the request — there is no `storeId` parameter to tamper with, and a key cannot
see or touch another store's data.

Operators mint keys from the server:

```bash
npx tsx scripts/api-key.ts mint <storeCode> "My storefront" --days 365
npx tsx scripts/api-key.ts mint <storeCode> "Catalog mirror" --scopes products:read,stock:read
npx tsx scripts/api-key.ts list   <storeCode>
npx tsx scripts/api-key.ts revoke <keyPrefix>
```

The secret is shown once and only its SHA-256 hash is stored. If it is lost,
revoke and mint a new one. Revocation takes effect on the very next request —
authorization is re-checked against the database every time, never cached.

### Scopes

| Scope | Grants |
|---|---|
| `products:read` | `GET /products` |
| `stock:read` | `GET /stock` |
| `orders:create` | `POST /orders` |

Give a public catalog mirror the two read scopes only. A key without a scope
gets `403 insufficient_scope`.

### Rate limits

Per key: 120 read requests/minute, 30 orders/minute. Over the limit returns
`429` with a `Retry-After` header in seconds.

---

## GET /products

Full catalog plus live stock. Cursor-paginated.

| Query | Meaning |
|---|---|
| `limit` | 1–100, default 50 |
| `cursor` | `nextCursor` from the previous page |
| `updatedSince` | ISO 8601; only products changed at or after this instant |

```bash
curl -H "Authorization: Bearer $KEY" \
  "https://host/api/v1/products?limit=50&updatedSince=2026-09-15T19:00:00Z"
```

```json
{
  "data": [{
    "id": "cmtq...", "sku": "DEMO-TSHIRT", "barcode": null,
    "name": "T-shirt Classique", "slug": "t-shirt-classique", "description": null,
    "price": 120, "stock": 31, "unit": "piece", "hasVariants": true,
    "category": { "id": "cmtq...", "name": "Vêtements", "slug": "vetements" },
    "images": ["https://..."],
    "variants": [{ "id": "cmtq...", "sku": "DEMO-TSHIRT-S-NOIR", "price": 120, "stock": 8, "imageUrl": null }],
    "updatedAt": "2026-09-08T16:59:42.659Z"
  }],
  "nextCursor": "cmts...",
  "syncedAt": "2026-09-15T19:33:41.946Z"
}
```

For a product with `hasVariants: true`, the top-level `stock` is the sum of its
active variants, and an order must name a `variantId`.

Cost and profit fields are never returned.

## GET /stock

The cheap, high-frequency endpoint. Quantities only — poll this every few
seconds instead of re-pulling the catalog.

One of these is required:

| Query | Meaning |
|---|---|
| `ids` | 1–200 comma-separated product ids (e.g. the items in a cart) |
| `updatedSince` | ISO 8601; everything that moved since |

```json
{
  "data": [{
    "productId": "cmtq...", "sku": "DEMO-TSHIRT", "available": 31,
    "variants": [{ "variantId": "cmtq...", "sku": "DEMO-TSHIRT-S-NOIR", "available": 8, "updatedAt": "..." }],
    "updatedAt": "2026-09-08T16:59:42.659Z"
  }],
  "syncedAt": "2026-09-15T19:33:58.333Z"
}
```

**Poll with the previous `syncedAt` minus a few seconds of overlap.** A row
updated in the same millisecond as your cutoff could otherwise be skipped.
Re-reading a row costs nothing; missing one causes an oversell.

## POST /orders

A customer bought something. This is the call that decrements central stock.

```json
{
  "idempotencyKey": "shop1-order-88213",
  "customerName": "Web Shopper",
  "customerPhone": "+212...",
  "items": [
    { "productId": "cmtq...", "variantId": "cmtq...", "quantity": 1 }
  ]
}
```

`idempotencyKey` is required (8–200 chars). Use your own order id, prefixed per
site so two storefronts cannot collide.

There is no price or discount field. Prices come from the database, so a
tampered request body cannot change what is charged or recorded.

| Status | Meaning |
|---|---|
| `201` | Created. Stock decremented. |
| `200` | Replayed — this `idempotencyKey` was already recorded. Stock was **not** touched again. Same order returned. |
| `404` | `product_unavailable` / `variant_unavailable` — not in this store, or not active. Delist it. |
| `409` | `insufficient_stock` — someone else took the last unit. Refresh from `/stock`. |
| `422` | `invalid_body`, `invalid_quantity`, `variant_required`, `product_not_api_sellable` |
| `503` | `invoice_contention` — transient; retry with the same key. |

```json
{ "data": { "id": "cmu3...", "invoiceNumber": "INV-000002", "total": 144,
            "createdAt": "2026-09-15T19:33:57.374Z", "replayed": false } }
```

### Why you cannot oversell

The `stock >= quantity` test lives inside the UPDATE statement, so Postgres
serialises concurrent orders on the row: exactly one wins the last unit and the
rest get `409`. Stock can never go negative, no matter how many sites order the
same item in the same instant.

Verified: 12 simultaneous orders against a variant holding 8 units produced
8 committed sales, 8 distinct invoices, 4 rejections, and 0 negative rows.

### Retry rules

- `409` — do **not** retry blindly. Refresh stock and tell the customer.
- `503` / `500` / network timeout — retry with the **same** `idempotencyKey`.
  A timeout may mean the order committed; the same key returns it rather than
  charging the customer twice.

---

## Errors

Every failure has the same shape. Branch on `code`, show `message`.

```json
{ "error": { "code": "insufficient_stock", "message": "Not enough stock for \"T-shirt Classique\" (6 available)." } }
```

| Code | Status |
|---|---|
| `unauthorized` | 401 |
| `insufficient_scope`, `credential_inactive`, `api_not_enabled` | 403 |
| `product_unavailable`, `variant_unavailable` | 404 |
| `rate_limited` | 429 |
| `invalid_parameter`, `invalid_json` | 400 |
| `invalid_body` and the order validation codes | 422 |
| `insufficient_stock` | 409 |
| `internal_error` | 500 |

All responses are `Cache-Control: no-store` — stock figures must never be
served from a cache.

## Recommended sync loop

1. On first connect, walk `GET /products` with `cursor` to seed your catalog.
2. Every 30–60s, `GET /products?updatedSince=<last syncedAt − 5s>` for names,
   prices and new items.
3. Every 5–15s, `GET /stock?updatedSince=<last syncedAt − 5s>` for quantities.
4. At add-to-cart and at checkout, `GET /stock?ids=<cart items>` for the live
   figure.
5. On purchase, `POST /orders`. Treat `409` as "sold out, apologise"; the other
   sites converge on the new number at their next poll.

Stock displayed on a storefront is always a cached number. `POST /orders` is
the only authority: a `201` means you got the units, and nothing else does.
