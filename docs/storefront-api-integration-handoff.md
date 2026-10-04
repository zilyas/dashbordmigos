# Storefront API — integration handoff

Everything a multi-tenant SaaS needs to merge this product catalogue. Every
field name, type and error code below was read out of the source, not from
memory, and `src/app/api/v1/contract.test.ts` now fails the build if any of
them changes — so these shapes will not drift under you.

Companion document: `docs/storefront-api.md` (the narrative guide). This file
is the terse reference.

---

## 0. The one thing that shapes your architecture

**There is no tenant header and no tenant parameter.** Not `X-Tenant-Slug`,
not `tenant_id`, nothing.

The API key *is* the tenant. Each `ApiClient` row is pinned to exactly one
`storeId`, and every query is scoped from the credential row:

```ts
// src/app/api/v1/products/route.ts:43-46
// storeId comes from the credential row, never from a query param — this
storeId: auth.context.storeId,
```

**Consequence: one key per store.** A SaaS serving N shops stores N keys, one
per tenant row. You cannot mint one key and switch shops with a header. That
is deliberate — a header-scoped tenant is one typo away from serving shop A's
stock and prices to shop B.

Server-to-server only. **No CORS headers are sent, on purpose.** A browser
`fetch` fails by design; call from your backend.

---

## 1. Authentication

```
Authorization: Bearer sk_<12-hex>_<base64url-secret>
```

Pattern (`src/lib/api/keys.ts:20`):
`^sk_([0-9a-f]{12})_([A-Za-z0-9_-]{32,})$`

The `sk_<12-hex>` prefix is stored in clear and is safe to log for support.
**The secret half is never recoverable** — only a SHA-256 hash is stored, and
the full key is displayed exactly once at creation.

| | |
|---|---|
| Max active keys per store | **10** |
| Expiry choices | 30 / 90 / 180 / **365** days (365 default, 365 max) |
| Rotation | Mint the new key, deploy it, then revoke the old one. Both work at once, so there is zero downtime. |

---

## 2. Scopes

Three, and they are checked per endpoint:

| Scope | Grants |
|---|---|
| `products:read` | Catalogue: products, prices, images |
| `stock:read` | Stock levels |
| `orders:create` | Place orders, which lowers real stock |

A key missing the scope gets `403 insufficient_scope`, and the body carries an
extra `requiredScope` field naming what was needed.

---

## 3. `GET /api/v1/products`

Query parameters:

| Param | Type | Notes |
|---|---|---|
| `limit` | int | default **50**, max **100** |
| `cursor` | string | the previous page's `nextCursor` |
| `updatedSince` | ISO 8601 | poll for changes |

### Response — exactly these keys

```json
{
  "data": [
    {
      "id": "clx7a2b9c0000qwerty",
      "sku": "TSHIRT-001",
      "barcode": "5901234123457",
      "name": "Cotton T-Shirt",
      "slug": "cotton-t-shirt",
      "description": "Short sleeve, 180gsm.",
      "price": 149.99,
      "stock": 42,
      "unit": "piece",
      "hasVariants": true,
      "category": { "id": "clx...", "name": "Shirts", "slug": "shirts" },
      "images": ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
      "variants": [
        {
          "id": "clx...",
          "sku": "TSHIRT-001-M-RED",
          "barcode": "5901234123464",
          "price": 149.99,
          "stock": 12,
          "imageUrl": "https://cdn.example/m-red.jpg"
        }
      ],
      "updatedAt": "2026-10-04T18:22:41.000Z"
    }
  ],
  "nextCursor": "clx7a2b9c0000qwerty",
  "syncedAt": "2026-10-05T09:00:00.000Z"
}
```

Field notes that will bite you if missed:

- `category` is **nullable** — a product need not have one.
- `images` is an array of URL strings, not objects.
- `variants` is `[]` when `hasVariants` is `false`.
- A variant's `price` falls back to the parent's price when the variant has no
  own price, so it is **never null** — no need to coalesce.
- **`stock` on a variant product is the SUM of its live variants**, not the
  parent column. The parent column is stale by design; nothing syncs it from
  the children. Do not read the parent row's stock from anywhere else.
- `nextCursor` is `null` on the last page. **That is the only end-of-walk
  signal here** — `/products` has no `hasMore`.

---

## 4. `GET /api/v1/stock`

The cheap, frequent call. Two mutually exclusive modes:

| Mode | Param | Notes |
|---|---|---|
| Spot check | `ids=id1,id2,...` | 1–**200** ids. Not paginated. |
| Poll | `updatedSince=<ISO>` + `cursor` | `limit` default **50**, max **200** |

`cursor` combined with `ids` is rejected with `400 invalid_parameter` — the
`ids` mode is already bounded at 200, so there is nothing to page.

### Response — exactly these keys

```json
{
  "data": [
    {
      "productId": "clx7a2b9c0000qwerty",
      "sku": "TSHIRT-001",
      "available": 42,
      "variants": [
        {
          "variantId": "clx...",
          "sku": "TSHIRT-001-M-RED",
          "available": 12,
          "updatedAt": "2026-10-04T18:22:41.000Z"
        }
      ],
      "updatedAt": "2026-10-04T18:22:41.000Z"
    }
  ],
  "hasMore": false,
  "nextCursor": null,
  "syncedAt": "2026-10-05T09:00:00.000Z"
}
```

- Note the **different field names from `/products`**: `productId` not `id`,
  `available` not `stock`, `variantId` not `id`. Deliberate, so a stock payload
  can never be mistaken for a catalogue payload.
- **`available` on a product row is the SUM of live variants** when the product
  has variants, same rule as `/products.stock`.
- **Pagination asymmetry, and you must code for both:** `/stock` reports
  `hasMore`, and the walk is done when `hasMore` is `false`. `/products` has no
  `hasMore` and signals the end with `nextCursor: null`. In `ids` mode,
  `hasMore` is always `false` and `nextCursor` always `null`.
- Ordering is `(updatedAt, id)`, so a timestamp tie cannot skip a row as you
  advance your watermark.

---

## 5. `POST /api/v1/orders`

**This writes. It decrements real stock.**

### Request body — exactly these fields

```json
{
  "idempotencyKey": "order-2026-0001",
  "customerName": "Sara B.",
  "customerPhone": "0600000000",
  "items": [
    { "productId": "clx...", "quantity": 2 },
    { "productId": "clx...", "variantId": "clx...", "quantity": 1 }
  ]
}
```

| Field | Rule |
|---|---|
| `idempotencyKey` | **required**, 8–200 chars, unique per store |
| `customerName` | optional, ≤120 chars |
| `customerPhone` | optional, ≤30 chars |
| `items` | 1–100 entries |
| `items[].productId` | required |
| `items[].variantId` | **required** when the product has variants, **rejected** when it does not |
| `items[].quantity` | positive number |

**There is deliberately no `price`, no `discountPercent` and no
`allowExpiredOverride` field.** They do not exist rather than being validated
and ignored, so a storefront key cannot mint free goods or bypass expiry
rules. Money is always recomputed server-side from the catalogue row plus the
store's tax rate. Send a price and it is silently not a field — your total
will be the server's total.

### Idempotency placement — in the JSON body, NOT a header

There is no `Idempotency-Key` header. It is `idempotencyKey` inside the body.

Semantics:

| Case | Result |
|---|---|
| New key | `201` with `"replayed": false` |
| Same key, **same** body | `200` with `"replayed": true`, returns the first order |
| Same key, **different** body | `409 idempotency_key_reused` |

A body hash is stored with the key, which is why a changed body is caught.
**Practical rule: one key per checkout attempt, reused across retries of that
same attempt.** If your Laravel job recalculates the cart and retries with a
new total under the same key, you get a `409`, not a new order.

### Response

```json
{
  "data": {
    "id": "clx...",
    "invoiceNumber": "INV-000123",
    "total": 449.97,
    "createdAt": "2026-10-05T09:00:00.000Z",
    "replayed": false
  }
}
```

`invoiceNumber` format is `INV-` plus a 6-digit zero-padded sequence.

---

## 6. Price and currency types — read this carefully

**Every monetary and quantity value is a JSON number, not a string.**
`price`, `stock`, `available` and `total` all arrive as numbers.

**No response carries a currency field.** Not on a product, not on an order.
Currency is a per-store property (`Store.currency`, default `"MAD"`) and is not
exposed through the API at all. You must store the currency on your own tenant
row, alongside the key.

**The precision trap.** Underneath, these are PostgreSQL `Decimal(12,3)`
columns — three decimal places, because stock can be weight-priced. The server
normalizes through `round3 = Math.round(n * 1000) / 1000`.

They are serialized to JSON as **numbers**, so a naive PHP `json_decode` gives
you a float, and `0.1 + 0.2 !== 0.3` in binary floating point. If you sum line
items in PHP floats and compare against the server's `total`, the two will
disagree by fractions of a unit and your reconciliation will fail
intermittently rather than loudly.

Use `bcmath` / `brick/money` / integer minor units, or decode with
`JSON_BIGINT_AS_STRING`-style handling and parse as decimal. Do not do money
arithmetic in PHP floats.

Tax is applied server-side from `Store.taxRate` (`Decimal(5,2)`). You cannot
set or override it.

---

## 7. Error bodies

Every error, on every endpoint, is this shape — never HTML:

```json
{ "error": { "code": "insufficient_stock", "message": "Not enough stock." } }
```

Two documented extras:
- `requiredScope` on `403 insufficient_scope`
- `issues` (array) on `422 invalid_body`, from Zod validation

### Complete code table

| Status | Code | When |
|---|---|---|
| 400 | `invalid_parameter` | bad `limit`, bad `ids`, `cursor` sent with `ids` |
| 400 | `invalid_json` | body is not parseable JSON |
| 401 | `unauthorized` | missing, malformed, unknown, or wrong-secret key |
| 403 | `credential_inactive` | key revoked, expired, or its store is inactive |
| 403 | `insufficient_scope` | key lacks the endpoint's scope |
| 403 | `api_not_enabled` | **the owner has not enabled the API for this store** |
| 404 | `not_found` | no such endpoint |
| 404 | `store_not_found` | the key's store vanished |
| 404 | `product_unavailable` | product missing or not sellable |
| 404 | `variant_unavailable` | variant missing |
| 405 | `method_not_allowed` | wrong HTTP method; carries an `Allow` header |
| 409 | `idempotency_key_reused` | same key, different body |
| 409 | `insufficient_stock` | not enough stock, pre-check or in-transaction race |
| 422 | `invalid_body` | schema violation; see `issues` |
| 422 | `product_not_api_sellable` | **batch-tracked product — see below** |
| 422 | `invalid_quantity` | non-integer for a product that requires whole units |
| 422 | `variant_required` | product has variants, none given |
| 422 | `variant_not_applicable` | variant given for a product without variants |
| 429 | `rate_limited` | over the limit; carries `Retry-After` in seconds |
| 500 | `internal_error` | retry with the **same** `idempotencyKey` |
| 503 | `invoice_contention` | invoice-number contention; safe to retry |

`401` is identical for "no such key prefix" and "wrong secret", so the API
cannot be used to confirm which prefixes exist. Do not try to distinguish them.

### Known limitation to plan around

**Batch-tracked products cannot be sold through the API yet** — they return
`422 product_not_api_sellable`. Batch/FEFO allocation is a separate code path
with its own reconciliation invariants, and the API refuses these products
rather than duplicating it half-correctly. If a tenant turns on batch tracking
for a product, your storefront must hide it or handle that 422 gracefully.

---

## 8. Rate limits

| Bucket | Limit |
|---|---|
| Reads (`/products`, `/stock`) | **120 / min** |
| Orders (`/orders`) | **30 / min** |
| Pre-auth, per IP + key prefix | 20 / min |
| Pre-auth, per IP | 120 / min |

The two pre-auth buckets are spent **before** the database lookup, so a bad key
never reaches the DB. `429` always carries `Retry-After` in seconds — honour
it; do not fixed-sleep.

**Current ceiling, stated plainly:** the limiter is in-memory and
single-instance (`src/lib/security/rate-limit.ts`). One container today, so the
published numbers are real. If the dashboard is ever scaled to two containers
the effective limits double until the bucket moves to Redis or Postgres.

---

## 9. Request tracing

Every `/api/*` response carries an **`x-request-id`** header. Log it on your
side for every call. It is the only thing that makes "a 500 at 3am" traceable —
without it, support has only your client id and a rough timestamp.

If you send your own `x-request-id`, it is echoed back, so you can correlate
with your own Laravel request id.

All responses are `Cache-Control: no-store`, errors included.

---

## 10. Enablement process, per store

Four steps, in order. Steps 1 and 2 are console actions in the dashboard that
**only those roles can perform** — they cannot be done through the API, and
they cannot be done by us on a tenant's behalf.

1. **Platform owner enables the API for that store.**
   Stores → Edit the store → tick **Storefront API**.
   Off by default for every store. While it is off, a perfectly valid key
   returns `403 api_not_enabled` on every request. The flag is read from the
   row already fetched during auth, so switching it off stops the **very next**
   request — there is no cache and nothing to invalidate.

2. **That store's Manager mints the key.**
   The **Storefront API** item appears in their sidebar only once step 1 is
   done. Then `/integrations` → **New key** → name it, pick scopes, pick an
   expiry → the full key is shown **once**.

   It must be the Manager, not the owner: the key is attributed to a real
   person in that store (`actorUserId`), so every API sale traces back to
   someone who chose to create it. The platform owner has no store and
   therefore cannot mint.

3. **You store the key against your tenant row**, together with that store's
   currency (the API does not return it — see §6).

4. **Verify**: `GET /api/v1/products?limit=1` with the key. A `200` confirms
   the whole chain — flag on, key valid, scope granted.

To offboard a tenant: the Manager revokes the key at `/integrations`. The next
request returns `403 credential_inactive` immediately, with no cache.

---

## 11. Sandbox key and test store — ACTION REQUIRED, not yet available

**No sandbox environment exists today.** There is one deployment and it is
production, with real stock and real sales. This is the one thing in your list
that cannot be answered from the repository, and it should not be improvised:

- A key minted against the live store would make your integration tests
  decrement **real inventory** on a working shop. A single `POST /orders` in a
  CI run is a real stock loss and a real invoice number consumed.
- A key pasted into a chat, ticket or CI log is compromised by disclosure and
  must be revoked.

**What needs to happen before you can verify against a server:**

1. Create a **separate test store** in the dashboard with throwaway products
   and stock you do not care about. Multi-store is already supported, so this
   needs no new code — but note it shares the same database as the live stores,
   so it is an isolated *tenant*, not an isolated *environment*.
2. Owner enables **Storefront API** on that test store only (§10 step 1).
3. That test store's Manager mints a key with a **short expiry** (30 days) and
   only the scopes you are testing. Grant `orders:create` only when you are
   ready to write.
4. Deliver the key **out of band** — a password manager or a secrets store,
   never chat, email, a ticket, or a repo. Treat it as live from the moment it
   is displayed.

**Until that exists, verify against the contract instead of a server.**
`src/app/api/v1/contract.test.ts` (34 tests) locks every field name and type in
this document — build your Laravel DTOs against the JSON above and you are
coding against an enforced contract, not a guess. That is enough to write and
unit-test the client; you only need a live key for end-to-end.

---

## 12. Sync strategy

- Catalogue: walk `/products` with `cursor` until `nextCursor` is `null`. Then
  poll `updatedSince` with your last `syncedAt`.
- Stock: poll `/stock?updatedSince=...`, following `nextCursor` while `hasMore`
  is `true`. Before checkout, spot-check the cart with `/stock?ids=...`.
- **Stock is advisory, never authoritative.** It is a snapshot; someone can sell
  the last unit in the shop between your check and your order. The order
  endpoint is the only authority — it tests `stock >= quantity` inside the
  UPDATE, so two concurrent orders can never both pass. **Always handle
  `409 insufficient_stock` at checkout**, even if `/stock` said yes a second
  earlier.
- Advance your watermark from `syncedAt` in the response, not from your own
  clock.
