# Storefront API

This API lets an external website read a store's catalogue and stock, and place orders. Use it to connect your e-commerce site to this back-office dashboard.

## Table of contents

- [Getting a key](#getting-a-key)
- [Authentication](#authentication)
- [Endpoints](#endpoints)
  - [GET /api/v1/products](#get-apiv1products)
  - [GET /api/v1/stock](#get-apiv1stock)
  - [POST /api/v1/orders](#post-apiv1orders)
- [Keeping a storefront in sync](#keeping-a-storefront-in-sync)
- [Placing an order safely](#placing-an-order-safely)
- [Error reference](#error-reference)
- [Rate limits](#rate-limits)
- [Request tracing](#request-tracing)
- [Gotchas](#gotchas)

## Getting a key

A store manager creates the key. You cannot create your own key.

1. The store manager signs in to the dashboard.
2. The store manager opens **Storefront API** in the dashboard menu. This page only appears when the platform owner has turned the storefront API on for the store. See [Authentication](#authentication).
3. The store manager clicks **New key**.
4. The store manager types a name for the key (for example, "Main website"), picks the permissions the key needs, and picks an expiry (30, 90, 180, or 365 days).
5. The dashboard shows the new key one time only, in a dialog titled "Your new key". The store manager must copy it now. The dashboard cannot show it again. If it is lost, the store manager must revoke the key and make a new one.

A key looks like this:

```
sk_1a2b3c4d5e6f_r3JpM2VfeGFtcGxlX3NlY3JldF9wYXJ0
```

The key has two parts after the `sk_` prefix marker:

- A 12-character hexadecimal prefix. The dashboard shows this part next to the key's name so a manager can tell keys apart without seeing the secret.
- A secret part. The dashboard never stores this part and never shows it again after creation.

Send the whole string, prefix and secret together, as your API key.

## Authentication

Send the key in the `Authorization` header on every request:

```
Authorization: Bearer sk_xxxxxxxxxxxx_YOUR_SECRET_HERE
```

The store must also have the storefront API feature switched on. Only the platform owner can switch this on, from the store's edit screen. If the feature is off, every request gets:

```json
{
  "error": {
    "code": "api_not_enabled",
    "message": "The storefront API is not enabled for this store. Ask the platform owner to switch it on."
  }
}
```

with HTTP status `403`. Ask the platform owner to turn the feature on before you integrate.

Each key also has a fixed set of permissions, called scopes. There are three:

| Scope | Lets the key |
|---|---|
| `products:read` | Read the catalogue: products, prices, images |
| `stock:read` | Read stock levels |
| `orders:create` | Place orders. Placing an order lowers stock |

A key can only call the endpoints that match its scopes. Ask the store manager to give your key every scope you need.

## Endpoints

Every response carries `Cache-Control: no-store` and an `x-request-id` header. See [Request tracing](#request-tracing).

### GET /api/v1/products

Required scope: `products:read`.

Returns the store's active catalogue with live stock and prices. Cost and profit fields are never included; see [Gotchas](#gotchas).

Query parameters:

| Name | Type | Default | Limit |
|---|---|---|---|
| `limit` | integer | 50 | 1 to 100 |
| `cursor` | string | none | the `id` of the last product from a previous page |
| `updatedSince` | ISO 8601 timestamp string | none | must parse as a valid date, or you get a `400` |

Example request:

```bash
curl "https://your-dashboard-domain.example.com/api/v1/products?limit=50" \
  -H "Authorization: Bearer sk_xxxxxxxxxxxx_YOUR_SECRET_HERE"
```

Example response:

```json
{
  "data": [
    {
      "id": "cku1product001",
      "sku": "TS-BLK-M",
      "barcode": "0123456789012",
      "name": "Black T-Shirt",
      "slug": "black-t-shirt",
      "description": "100% cotton crew neck.",
      "price": 19.99,
      "stock": 42,
      "unit": "PIECE",
      "hasVariants": true,
      "category": { "id": "ckucat001", "name": "Apparel", "slug": "apparel" },
      "images": ["https://cdn.example.com/products/ts-blk.jpg"],
      "variants": [
        {
          "id": "ckuvariant001",
          "sku": "TS-BLK-M",
          "barcode": "0123456789012",
          "price": 19.99,
          "stock": 42,
          "imageUrl": null
        }
      ],
      "updatedAt": "2026-09-20T14:03:11.000Z"
    }
  ],
  "nextCursor": "cku1product001",
  "syncedAt": "2026-09-25T09:12:00.000Z"
}
```

Notes on the fields:

- `price` and each variant `price` are numbers, in the store's currency.
- `stock` on a product with `hasVariants: true` is the sum of all its active variants' stock. Use each variant's own `stock` value to sell a specific variant.
- `category` is `null` when the product has no category.
- `nextCursor` is `null` when there is no next page.

### GET /api/v1/stock

Required scope: `stock:read`.

Returns quantities only. Use this endpoint to poll for stock changes cheaply and often, instead of re-reading the whole catalogue.

This endpoint has two modes. Pick one per request.

**Mode 1 — a known list of products.** Pass `ids`. Do not pass `cursor` in this mode; the server rejects that combination with `400`.

**Mode 2 — everything changed since a point in time.** Pass `updatedSince`. Page through results with `limit` and `cursor`.

You must pass `ids` or `updatedSince`. A request with neither gets `400 invalid_parameter`.

Query parameters:

| Name | Type | Default | Limit |
|---|---|---|---|
| `ids` | comma-separated product ids | — | 1 to 200 ids |
| `updatedSince` | ISO 8601 timestamp string | — | must parse as a valid date |
| `limit` | integer | 50 | 1 to 200 (used only with `updatedSince`) |
| `cursor` | string | none | the `productId` of the last row from a previous page; not allowed together with `ids` |

Example request:

```bash
curl "https://your-dashboard-domain.example.com/api/v1/stock?ids=cku1product001,cku1product002" \
  -H "Authorization: Bearer sk_xxxxxxxxxxxx_YOUR_SECRET_HERE"
```

Example response:

```json
{
  "data": [
    {
      "productId": "cku1product001",
      "sku": "TS-BLK-M",
      "available": 42,
      "variants": [
        {
          "variantId": "ckuvariant001",
          "sku": "TS-BLK-M",
          "available": 42,
          "updatedAt": "2026-09-20T14:03:11.000Z"
        }
      ],
      "updatedAt": "2026-09-20T14:03:11.000Z"
    }
  ],
  "hasMore": false,
  "nextCursor": null,
  "syncedAt": "2026-09-25T09:12:00.000Z"
}
```

`hasMore` is always `false` when you query by `ids`, because that mode returns the full set you asked for in one page.

### POST /api/v1/orders

Required scope: `orders:create`.

Creates one order and lowers stock. Read [Placing an order safely](#placing-an-order-safely) before you call this endpoint in production.

Request body fields:

| Name | Type | Required | Limit |
|---|---|---|---|
| `idempotencyKey` | string | yes | 8 to 200 characters |
| `customerName` | string | no | up to 120 characters |
| `customerPhone` | string | no | up to 30 characters |
| `items` | array | yes | 1 to 100 items |
| `items[].productId` | string | yes | at least 1 character |
| `items[].variantId` | string | required only if the product has variants | at least 1 character |
| `items[].quantity` | number | yes | must be positive |

There is no price field and no discount field. The server always prices the order from its own catalogue and the store's tax rate. You cannot send a price.

Example request:

```bash
curl -X POST "https://your-dashboard-domain.example.com/api/v1/orders" \
  -H "Authorization: Bearer sk_xxxxxxxxxxxx_YOUR_SECRET_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "order-8f3a1c2d-0001",
    "customerName": "Jane Doe",
    "customerPhone": "+15551234567",
    "items": [
      { "productId": "cku1product001", "variantId": "ckuvariant001", "quantity": 2 }
    ]
  }'
```

Example response, new order (HTTP `201`):

```json
{
  "data": {
    "id": "ckusale00001",
    "invoiceNumber": "INV-000123",
    "total": 39.98,
    "createdAt": "2026-09-25T09:12:03.000Z",
    "replayed": false
  }
}
```

Example response, replayed order (HTTP `200`): the same shape, with `"replayed": true` and the original order's data. See [Placing an order safely](#placing-an-order-safely).

## Keeping a storefront in sync

This is the most important section. Follow it to keep your website's catalogue and stock lined up with the dashboard, without missing changes or double-counting them.

Both `/api/v1/products` and `/api/v1/stock` sort results by `updatedAt`, and then by `id` when two rows have the same `updatedAt`. Always read pages in that order. The `id` tie-break matters: without it, two rows updated in the same millisecond could land on either side of a page boundary in an order the database does not guarantee, and you could skip a row or read it twice.

Do this loop:

1. **First sync.** Call `GET /api/v1/products` with no `updatedSince`. Store every product you get back.
2. **Walk the pages.** If the response's `nextCursor` is not `null`, call the endpoint again with `cursor` set to that value. Keep doing this until `nextCursor` is `null`. Do the same for `/api/v1/stock` if you track stock separately from the catalogue.
3. **Remember the sync time.** When a page walk finishes, save the `syncedAt` value from that last response. This is a plain field in the response body, not a header.
4. **Poll for changes.** On your next poll, call the same endpoint again, but this time pass `updatedSince` set to the `syncedAt` value you saved, minus a few seconds. The few seconds of overlap matter: re-reading a row you already have is free, but missing one that changed can make your site oversell.
5. **Walk those pages too**, the same way as step 2, using `cursor` and `nextCursor` until `nextCursor` is `null`.
6. **Save the new `syncedAt`** from the last page of that poll, and go back to step 4.

Between polls, your website must persist two things:

- The last `syncedAt` value you finished a poll on. Use it (minus a small buffer) as the next `updatedSince`.
- The current `cursor`, only while a single page walk is in progress. Once `hasMore` (on `/api/v1/stock`) or a `null` `nextCursor` (on `/api/v1/products`) tells you the walk is done, you no longer need it.

For a fast-changing stock number without full catalogue detail, poll `/api/v1/stock` with `updatedSince` on its own short interval. It is cheaper than `/api/v1/products` because it returns quantities only.

If you already know which products are in a customer's cart, you can skip the `updatedSince` loop for that check and call `/api/v1/stock?ids=...` instead, for an exact, immediate read of just those items.

## Placing an order safely

Every order needs an `idempotencyKey`: a string you generate, 8 to 200 characters long, unique per order in your store. Use a fresh key for every distinct order — for example, one built from your own cart or order id.

What happens when you send the same key again:

- **Same key, same order contents:** the server returns the ORIGINAL order again. HTTP status is `200`, and the body has `"replayed": true`. Stock is not lowered a second time.
- **Same key, different order contents:** the server refuses it. HTTP status is `409`, with `"code": "idempotency_key_reused"`. This means the key was already used for a different basket. Generate a new key for the new order; do not reuse the old one.

Retry rule: if you get a `5xx` status, or the request times out and you never got a response, retry the exact same request with the SAME `idempotencyKey`. This is safe. If your first attempt actually succeeded on the server before the response was lost, the retry returns the same order as a replay instead of creating a second one.

Do not generate a new `idempotencyKey` on a retry. A new key on a retry can create a duplicate order.

A `409 insufficient_stock` is not a retry case in the same way. It means someone else bought the last unit between your storefront's stock read and this order. Refresh stock from `/api/v1/stock` and let the customer choose again.

## Error reference

Every error has this shape:

```json
{
  "error": {
    "code": "some_code",
    "message": "Human-readable text."
  }
}
```

Some errors add extra fields next to `code` and `message`, noted below. Always check `error.code` in your code, not `error.message`. The message text can change; the code does not.

| HTTP status | `error.code` | When you get it |
|---|---|---|
| 400 | `invalid_parameter` | A query parameter is missing or badly formed (for example, a bad `updatedSince`, or `ids` outside its 1–200 range, or `cursor` combined with `ids`) |
| 400 | `invalid_json` | The order request body is not valid JSON |
| 401 | `unauthorized` | The `Authorization` header is missing, the key is malformed, or the key is wrong |
| 403 | `credential_inactive` | The key is revoked or expired, or its store or its owning user is inactive |
| 403 | `api_not_enabled` | The storefront API feature is off for this store |
| 403 | `insufficient_scope` | The key does not have the scope the endpoint needs. Adds a `requiredScope` field |
| 404 | `not_found` | The URL does not match any endpoint |
| 404 | `store_not_found` | Internal store lookup failed for this order |
| 404 | `product_unavailable` | A `productId` in the order does not exist in this store, or is not active |
| 404 | `variant_unavailable` | A `variantId` does not exist on that product, or is not active |
| 405 | `method_not_allowed` | You used the wrong HTTP method on a real endpoint. The response has an `Allow` header naming the method that is allowed |
| 409 | `idempotency_key_reused` | You reused an `idempotencyKey` with different order contents |
| 409 | `insufficient_stock` | Not enough stock to fill the order (or one line of it) at the moment of the attempt |
| 422 | `invalid_body` | The order body failed validation. Adds an `issues` array of `{ path, message }` |
| 422 | `product_not_api_sellable` | The product is batch-tracked and cannot be sold through this API yet |
| 422 | `invalid_quantity` | The quantity is not valid for that product (most products require a whole number) |
| 422 | `variant_required` | The product has variants and no `variantId` was sent |
| 422 | `variant_not_applicable` | A `variantId` was sent for a product that has no variants |
| 429 | `rate_limited` | You went over a rate limit. See [Rate limits](#rate-limits) |
| 500 | `internal_error` | Something failed on the server. For orders, retry with the same `idempotencyKey` |
| 503 | `invoice_contention` | The server could not assign an invoice number. Retry with the same `idempotencyKey` |

## Rate limits

There are two layers of limits. Both can produce `429 rate_limited` with a `Retry-After` header, which tells you how many seconds to wait before trying again.

**Per-key limits**, counted per API key:

| Bucket | Applies to | Limit |
|---|---|---|
| `read` | `GET /api/v1/products`, `GET /api/v1/stock` | 120 requests per minute |
| `orders` | `POST /api/v1/orders` | 30 requests per minute |

**Outer limits**, checked before your key is even looked up, so they apply even to a bad or missing key:

- 20 requests per minute per combination of caller IP address and key prefix.
- 120 requests per minute per caller IP address, across all keys and prefixes from that address.

Design your integration to stay under the per-key limits in normal use, and to back off on `429` using the `Retry-After` value rather than retrying immediately.

## Request tracing

Every response from `/api/*` carries an `x-request-id` header.

You can send your own `x-request-id` on a request. The server echoes it back if it matches this shape: letters, digits, dots, underscores, and hyphens only, no more than 128 characters. If your value does not match, or you send none, the server makes its own id and returns that instead.

Quote the `x-request-id` value from a failed response when you contact support. It lets support find the exact request in the logs.

## Gotchas

- Cost and profit fields are never returned by any endpoint. Only selling price is available.
- Every response has `Cache-Control: no-store`. Do not cache `/api/v1/stock` or `/api/v1/products` responses yourself; poll them fresh each time.
- A `405` response carries an `Allow` header naming the method the endpoint actually accepts.
- An order request cannot set a price or a discount. The server always computes money from its own catalogue and the store's tax rate.
- A batch-tracked product cannot be sold through this API yet. You get `422 product_not_api_sellable` if you try.
