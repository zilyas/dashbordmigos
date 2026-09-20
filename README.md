# Store Management Dashboard

A multi-tenant, multi-vertical retail/POS dashboard built with **Next.js 16 (App
Router)**, **React 19**, **Prisma 7 / PostgreSQL**, **NextAuth v5**, **Tailwind
CSS 4** and **shadcn/Radix UI**. Every store's data is fully isolated; roles are
`SUPER_ADMIN`, `MANAGER`, and `SELLER`.

The catalog works for **any store vertical**, and clothing-style categories get
optional **variant** support (store-scoped sizes & colors, per-variant SKU,
stock, price/cost overrides and images).

---

## 1. Requirements

- Node.js 20+ (24 recommended)
- A PostgreSQL database (e.g. [Neon](https://neon.tech))
- Optional: a Cloudflare R2 bucket for image storage

## 2. Setup

```bash
npm install                 # also runs `prisma generate` (postinstall hook)
cp .env.example .env        # then fill in the values (see below)
npx prisma migrate deploy   # apply migrations
npx prisma db seed          # super admin + demo data
```

> **Prisma client is generated automatically.** `prisma generate` runs on
> `postinstall`, `predev`, and `prebuild`, so a fresh checkout or CI run can
> never fail with an "empty generated client" type error. If you ever change
> `prisma/schema.prisma` and run the dev server directly (e.g. `npx next dev`
> instead of `npm run dev`), run `npx prisma generate` yourself first.

### Windows / locked-down environments

If native SWC bindings are blocked (Application Control), Turbopack cannot run.
Use Webpack for dev and build:

```bash
npx next dev --webpack
npx next build --webpack
```

## 3. Environment variables

See [`.env.example`](./.env.example) for the full list. Key groups:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | Postgres runtime / migration connection strings |
| `AUTH_SECRET` | NextAuth session signing secret (32-byte base64) |
| `SEED_SUPER_ADMIN_*`, `SEED_DEMO*` | Seed identity & demo toggle |
| `R2_*` | Cloudflare R2 image storage (optional) |
| `RATE_LIMIT_REDIS_REST_*` | Shared Upstash Redis rate limiter (optional; multi-replica only) |

### Cloudflare R2 setup (image storage)

Images are stored on **local disk by default** (`public/uploads`). To store them
in R2 instead, set all `R2_*` variables — the app switches automatically.

1. Cloudflare dashboard → **R2** → **Create bucket** (e.g. `dashboard`).
2. Bucket → **Settings** → enable the **Public Development URL** (or connect a
   custom domain). Copy it into `R2_PUBLIC_BASE_URL` (no trailing slash).
3. **R2 → Manage R2 API Tokens → Create API token** with **Object Read & Write**
   scoped to the bucket. Copy the **Access Key ID** and **Secret Access Key**.
4. Fill `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
   `R2_PUBLIC_BASE_URL` in `.env`.

> **Deploying with Docker / Coolify:** `R2_PUBLIC_BASE_URL` must be marked
> **buildtime-available**, not only a runtime variable. `next.config.ts` reads it
> when the config is resolved, to build both `images.remotePatterns` and the CSP
> `img-src` origin, and a standalone build bakes the resolved config into the
> image. If it is missing at build time, every product image 400s with
> `"url" parameter is not allowed` from `/_next/image` even though the variable
> is set correctly on the running container. It must stay set at runtime too —
> `src/lib/storage/r2.ts` uses it to build each object's public URL.

Uploads are always processed server-side: validated, decoded and re-encoded with
`sharp` to a **500×500 WebP** (`fit: cover`, metadata stripped), given a random
UUID key, and served from `R2_PUBLIC_BASE_URL`. Only the resulting URL is stored
in the database — secrets never reach the client.

### Rate limiting (login & password reset)

Login and password-reset attempts are rate limited. By default the limiter is
**in-memory**, which is correct for a **single app instance** — the counter
lives in that process and is not shared across replicas.

If you scale to **more than one replica** (or a serverless platform that spins up
multiple instances), the in-memory counter no longer sees all traffic, so set
both `RATE_LIMIT_REDIS_REST_URL` and `RATE_LIMIT_REDIS_REST_TOKEN` to switch to a
shared **Upstash Redis (REST)** backend. It uses the same async interface, so no
application code changes — the app switches automatically when both are set. Get
the values from the Upstash console → your database → **REST API**. If Redis is
unreachable at request time the limiter **fails open** (allows the request) and
logs the error; the DB-backed account lockout still protects against brute force.

## 4. Migrations & seed

```bash
npx prisma migrate dev --name <change>   # create + apply a migration (dev)
npx prisma migrate deploy                # apply pending migrations (prod)
npx prisma db seed                       # idempotent: super admin + demo data
```

The seed creates a `SUPER_ADMIN`, and (unless `SEED_DEMO=false`) a **demo store**
with a manager, seller, sizes (`S/M/L/XL`), colors (`Noir/Blanc/Rouge/Bleu`), a
clothing category, and a variant-enabled product. Demo login credentials are
printed to the console.

## 5. Variant product behavior

- A product is **simple** by default: it has one SKU, price and stock.
- Toggle **“This product has variants”** on the product form to make it
  **variant-enabled**. Manage variants individually from the product's edit page
  (size, color, SKU, barcode, price/cost overrides, stock, active flag, image).
- Sizes and colors are **store-scoped vocabularies** managed under
  **Sizes** and **Colors** in the sidebar. Mark a category as **Clothing** to
  signal it uses variants.
- In the **POS**, a variant product prompts the cashier to pick a variant; the
  sale uses that variant's stock and price. Returns restore stock to the exact
  variant sold. Simple products behave exactly as before.
- Stock deductions are **atomic** (a conditional `UPDATE`), so concurrent sales
  cannot oversell into negative stock. Invoice numbers retry on collision.

## 5b. Units & decimal quantities

Turn on **Units of measure** in the store Settings (feature flag) to give
products a unit (piece, kg, g, L, pack). A product can then opt into
**decimal quantity** (e.g. sell 0.5 kg). Rules:

- Decimals are allowed only when **both** the store has `units_enabled` **and**
  the product has `allowDecimalQuantity`. Everything else stays whole-number, so
  existing piece-based products are unchanged.
- Quantity/stock columns are `Decimal(12,3)` (0.001 resolution). Money stays at
  2 decimals; quantities round to 3. The atomic oversell guard works on decimals.
- In the POS, a decimal product shows a numeric quantity box with its unit;
  piece products keep the +/- stepper. Returns restore the exact quantity.

## 5c. Starter catalog templates

A Manager can optionally initialize a store's catalog for a common store type in
one click, from **Settings → Starter catalog**. Five templates are available:

| Template | Configures |
|---|---|
| **General retail** | Categories: General merchandise, Accessories, Services |
| **Clothing** | Categories (Clothing, Shoes, Accessories) with Brand/Material/Gender specs; standard sizes (XS–XL) and common colors; uses built-in Size/Color variants |
| **Grocery** | Categories (Food, Beverages, Household) with Brand/Weight/Origin specs; enables **units** + **category attributes** + a **Pack Size** variant axis |
| **Electronics** | Categories (Phones, Computers, Accessories) with Brand/Model/Warranty/Voltage specs; a **Storage** variant axis |
| **Cosmetics** | Categories (Skincare, Makeup, Fragrance) with Brand/Volume/Skin Type specs; a **Shade** variant axis |

Templates configure **catalog structure only**. They are:

- **Optional** — a store never has to use one; you can build a fully custom
  catalog instead (see below).
- **Non-destructive & idempotent** — applying a template only *adds* what's
  missing. An existing category, attribute, axis, size, or color with the same
  name/key is **reused, never overwritten**, so it's safe to run more than once.
  The result screen shows exactly what was added vs. reused.
- **Additive to feature flags** — a template only *enables* the flags it needs
  (e.g. Grocery turns on Units). It never disables a flag you already turned on.
- **Never** a source of products, stock, sales, users, or financial data.

Only a **Manager** can apply a template, and only to **their own store** — the
store is derived from the session, never from client input.

**Prefer a fully custom catalog?** Skip the templates entirely and build it by
hand: add categories under **Categories**, per-category specs via **Categories →
Manage attributes** (needs *Category attributes* on in Settings), custom axes
under **Variant axes** (needs *Custom variant axes* on), and **Sizes**/**Colors**
under their own pages. Templates are just a shortcut for these same screens.

## 5d. Batch / lot tracking

Optional per-product batch/lot tracking. When on, stock is tracked as dated
**batches**; the product/variant `stock` column is kept as a consistent
**aggregate cache** (invariant: `SUM(batch stock) == aggregate` per product, or
per variant for variant products). Batches allocate oldest-first (FIFO) until
expiry tracking is enabled, then earliest-expiring-first (FEFO) — see
**Expiry tracking** below.

**Enabling (store):** turn on **Expiry & batch tracking** in **Settings**
(`Store.features.expiry_batch_enabled`). With it off, no batch UI appears and
every product behaves exactly as before.

**Enabling (per product):** on the product **edit** page, a Manager clicks
**Enable batch tracking**. This atomically flips `trackBatch` and captures the
product's current stock (per variant) as an **`OPENING`** batch, so the invariant
holds from the start. Aggregate stock is unchanged. Tracking **cannot be disabled**
in this release, so enable it deliberately.

**Receiving & adjusting:** the edit page's **Batch inventory** section lets a
Manager receive stock into a new or existing batch code, and adjust a batch to a
counted absolute quantity (with a required reason). Both update the batch and the
aggregate together in one transaction and write an `InventoryMovement`. A
reconciliation indicator flags any drift. Only `inventory.manage` (MANAGER) can
do this.

**Selling (automatic):** Sellers never pick batches. `createSale` allocates
oldest-batch-first automatically; a line may split across batches. Both the batch
and the aggregate are decremented atomically in the sale transaction — a
concurrent race rolls the whole sale back (the Seller retries). If eligible batch
stock is insufficient, the sale is rejected with a clear message.

**Returns & deletion:** returns and sale deletions restore the **exact original
batches** via recorded allocations (partial and decimal returns supported;
over-return is blocked). Refund/tax/profit math is unchanged — it uses the
`SaleItem` money snapshots; batch `costPrice` is reporting metadata only and never
affects money. If a tracked sale's allocation history is missing/inconsistent, the
operation aborts rather than guessing.

**Reconciliation:** Manager-only read tools compare aggregate vs. batch totals per
product/variant and report discrepancies; they never auto-repair.

Sales rung up **before** a product was tracked have no allocations and keep the
original aggregate-only return/deletion path. Untracked products are unaffected
throughout. Design & rationale: `.ai/phase4-expiry-batch-design.md`.

### Expiry tracking (Phase 4c1)

An already batch-tracked product can additionally track **use-by dates**.

- **Store timezone:** set the store **Timezone** (IANA id, e.g.
  `Africa/Casablanca`) in **Settings** — new stores default to `UTC`. All expiry
  comparisons use date-only keys in this timezone (never the server clock, never a
  fixed UTC offset). A batch is **expired** when its date is *before* the
  store-local today; a batch **expiring today stays sellable for the whole local
  day**.
- **Enabling (per product):** in the **Batch inventory** section, a Manager clicks
  **Enable expiry tracking**, assigns a date to every current positive-stock
  batch, and confirms. It flips `trackExpiry` atomically in one transaction. It
  cannot be enabled while any positive-stock batch lacks a date, and **cannot be
  disabled** in this release. `trackExpiry` can only be turned on through this
  action — never through the generic product form.
- **Receiving:** an expiry date is **required** for expiry-tracked products;
  a past date is rejected. Receiving into an existing batch code must use the
  **same** date (a batch's date is never silently changed). A Manager can correct
  a date via the per-batch **Date** action (a batch with stock can't be moved to a
  past date).
- **Selling:** allocation is **FEFO** — earliest expiry first, then `receivedAt`.
  **Expired batches are never sold** (Sellers *and* Managers are blocked; there is
  no override yet), and null-date batches are never allocated for an
  expiry-tracked product. If aggregate stock is enough but non-expired batch stock
  is not, the whole sale is rejected with *"Insufficient non-expired stock for …"*
  and nothing is decremented.
- **Returns/deletion:** stock is restored to the **exact original batch** even if
  it has since expired — that batch **stays EXPIRED** (returned units are not made
  sellable again). Reconciliation still holds because expired stock is counted in
  the aggregate.
- **Status upkeep:** correctness never depends on a scheduled job — sale
  eligibility is computed directly from `expiryDate` vs the store-local today. A
  Manager-only maintenance action can mark past-date batches `EXPIRED` for tidy
  reporting; it never changes stock, aggregates, or allocations.

### Expiry reporting & notifications (Phase 4c2)

- **Report:** Managers get a store-scoped **Expiry report** at `/reports/expiry`
  (also linked from **Reports** when the store feature is on). Windows are computed
  from the **store-local today**: Expired (`<0` days), Today (`0`), ≤7 (`1–7`),
  ≤30 (`8–30`), ≤60 (`31–60`); each stock-bearing batch lands in exactly one
  bucket. Only `stock > 0`, non-`ARCHIVED` batches of `trackExpiry` products count;
  `trackExpiry` batches missing a date are surfaced as an integrity warning.
- **Stock value** per batch uses the first available **effective unit cost** —
  batch `costPrice` → variant cost → product cost — times quantity (money at 2
  decimals, quantity at 3). This never touches SaleItem profit/sales reporting.
- **CSV export** (`/api/reports/expiry/export?window=…`) reuses the same query and
  `csvEscape` (formula-injection-safe); the store is taken from the session, never
  a query param.
- **Manual refresh:** the report's **Refresh expiry status** button
  (`inventory.manage`) recomputes statuses and sends any due alerts for that store
  only; it's idempotent and logs a single activity entry.
- **Notifications:** active Managers get `EXPIRING_STOCK` / `EXPIRED_STOCK` alerts
  at four thresholds — enters 30-day, enters 7-day, expires today, becomes expired
  (no 60-day alert). A late sweep sends only the **most urgent current** threshold
  per batch. Alerts are **deduplicated** by a stable key
  `expiry:<batchId>:<expiryDate>:<threshold>` (a partial unique index +
  `ON CONFLICT DO NOTHING`), so repeated or concurrent sweeps never duplicate;
  correcting a batch's date produces a fresh key. Sellers never receive expiry
  alerts, and notification text never exposes cost.
- **Daily sweep (optional):** set `EXPIRY_CRON_SECRET` and have your deployment
  scheduler `POST /api/cron/expiry` once a day with
  `Authorization: Bearer <secret>` — e.g.
  `curl -X POST -H "Authorization: Bearer $EXPIRY_CRON_SECRET" https://<host>/api/cron/expiry`.
  With the variable unset the route returns **503** and does nothing; a wrong
  secret returns **401**; it returns only aggregate counts. **Sale eligibility does
  not depend on this sweep** — sales and reports classify directly from `expiryDate`
  vs the store-local today, so an un-run scheduler never sells expired stock. Both
  Managers and Sellers remain blocked from selling expired stock.

### Database backups

- **Contents:** a full application-level JSON dump of every table (schema version
  **2**; v1 files still restore, with their 15 missing tables read as empty). Login
  attempts are excluded — pure rate-limit telemetry. The file is **AES-256-GCM
  encrypted at rest** with `ENCRYPTION_KEY` before it touches disk or R2, because it
  contains password hashes, TOTP seeds and recovery-code hashes.
- **Manual:** Super Admin only, from **/backups** (`backup.manage`). Restore requires
  typing `RESTORE` and replaces **every** table in one transaction.
- **Scheduled (optional):** set `BACKUP_CRON_SECRET` and have your deployment
  scheduler `POST /api/cron/backup` with `Authorization: Bearer <secret>` — e.g.
  `curl -X POST -H "Authorization: Bearer $BACKUP_CRON_SECRET" https://<host>/api/cron/backup`.
  With the variable unset the route returns **503**; a wrong secret returns **401**.
  The run is attributed to the oldest active `SUPER_ADMIN` (a cron call has no
  session); if none exists it returns **503**. Failures are recorded as `FAILED`
  backup rows so a silently broken job is visible in the history, not just absent.
- **Retention:** after each *successful* scheduled run, `COMPLETED` backups older
  than `BACKUP_RETENTION_DAYS` (default 30) are deleted — file first, then record.
  Pruning never runs after a failure, so a run of failures cannot erode the window.
  When R2 is configured, **also set a bucket lifecycle rule** on the `backups/`
  prefix: this app deletes R2 objects best-effort only.

### Advanced batch workflows (Phase 5 — Manager-only)

- **Archive a batch:** the batch table's **Archive** action terminally retires a
  batch (damaged/recalled/written off) — it can no longer be sold or received, but
  its **stock is not changed** (still counted in the aggregate and shown greyed-out
  for history). To also write the stock off, adjust the batch to 0 first. A reason
  is required and logged.
- **Disable batch tracking:** the batch section's danger-zone **Disable batch
  tracking** reverts a product to a simple product — it archives every non-archived
  batch (kept for history), clears `trackBatch`/`trackExpiry`, and **preserves the
  current total stock** as a plain number, so direct stock edits work again.
  Reconciliation is verified first: a pre-existing aggregate/batch drift blocks the
  operation. Tracking can be re-enabled later (a new Opening batch is captured).
- **Return into a different batch:** in the return dialog, a Manager can optionally
  restore a returned line into a chosen **ACTIVE** batch (same store/product/variant)
  instead of the original — e.g. when the original was archived. The original
  allocation's `returnedQuantity` still advances (accounting stays correct); only the
  physical destination changes, cited on the inventory movement. Sellers never see
  this control, and an override into an archived or wrong-grain batch is rejected
  server-side. Refund/profit math is unaffected.
- **Sell expired stock (override):** normally both Sellers and Managers are blocked
  from selling expired stock. When a trackExpiry sale would fail for lack of
  non-expired stock **and** expired stock exists, a **Manager** (never a Seller) is
  offered an explicit *"Sell expired stock anyway"* confirmation. It expands
  eligibility to include expired batches **only as a last resort** (non-expired is
  always consumed first; a sale that doesn't need expired stock never touches it),
  still rolls back entirely if even expired stock is insufficient, and is fully
  audited: the allocation is flagged `fromExpired`, the inventory movement is noted,
  and a `sale.expiredOverrideUsed` activity entry records the invoice, product,
  batch, and acting Manager. The flag is honored only for a MANAGER session — a
  Seller's request is ignored server-side regardless of the payload.

Phase 4 (batch & expiry) is now feature-complete.

## 6. Roles & workflows

| Role | Can do |
|---|---|
| `SUPER_ADMIN` | Manage stores & managers globally; platform analytics, backups, security |
| `MANAGER` | Store-scoped catalog (products, categories, **sizes**, **colors**, **variants**), sellers, settings, reports, sales & returns |
| `SELLER` | POS sales (simple & variant products), returns, personal performance view |

Tenant scope for managers/sellers is always derived from the session — never from
client input. Authorization is enforced server-side in every action.

## 7. Tests

```bash
npm test           # run unit tests (vitest)
npm run test:watch # watch mode
```

Covers the sale/return money math, variant price/stock resolution, invoice
formatting, and the R2 upload pipeline (with the S3 client mocked).

## 8. Continuous Integration

Every push to any branch and every pull request runs the
`.github/workflows/ci.yml` GitHub Actions workflow. It is a **validation
gate only** — it never deploys anywhere.

Steps run in this order, and any failure fails the whole workflow (no
`continue-on-error` anywhere):

1. Checkout (full history — gitleaks scans the commit range)
2. Scan for secrets (gitleaks)
3. Setup Node 24 (with npm dependency caching)
4. `npm ci`
5. `npx prisma validate`
6. `npx tsc --noEmit`
7. `npx eslint .`
8. `npm run test` (vitest)
9. `npm run build -- --webpack`

Notes:

- `prisma generate` is **not** a separate CI step — `npm ci` already runs it
  via the `postinstall` script, and `npm run build` runs it again via
  `prebuild`. A third explicit invocation would be a pure duplicate.
- **No Postgres service container is used.** None of the 10 vitest suites
  under `src/lib/**/*.test.ts` import Prisma or touch a database, and every
  dashboard route calls `auth()` (which reads cookies), so Next treats them
  all as dynamic and never queries the database at build time. This was
  confirmed locally by pointing `DATABASE_URL` at an unreachable
  host/port and re-running `npm run build -- --webpack` with an identical
  result. The workflow sets `DATABASE_URL` and `AUTH_SECRET` to inert
  placeholder values purely so `prisma validate`/`next build` have
  something syntactically valid to read — nothing in CI ever reads or
  writes real data.
- The workflow needs zero real secrets, since it doesn't deploy or talk to
  any real service.

**Manual step required in GitHub:** branch protection with required status
checks is **not** configured from files and must be enabled manually in the
repository's Settings → Branches, selecting the `Validate` job as a required
check for `master`.

## 9. Useful scripts

```bash
npm run dev     # dev server (add --webpack on locked-down Windows)
npm run build   # production build (add --webpack on locked-down Windows)
npm run lint    # eslint
npm test        # vitest
```

## Data Subject Rights (GDPR)

This section tells you how the app handles two legal rights. These rights
come from GDPR. They are the right to get your data. They are also the
right to have your data erased.

The code is in `src/actions/user-data.ts`.

### Export your data

Any signed-in user can export their own data. Call `exportUserData()`. Do
not pass an ID.

A SUPER_ADMIN can export the data of any other user. Call
`exportUserData(targetUserId)`.

The export has these items:

- The user's own account fields (name, email, role, store, status, dates).
- Sales made by the user.
- Activity log entries about the user.
- Notifications sent to the user.
- Session metadata (device, IP, timestamps). The raw session token is not
  included.
- Two-factor status (on or off only).

The export does NOT have these items:

- The password hash.
- The two-factor secret.
- Recovery code hashes.
- Password history hashes.

These items are login credentials. They are not "your data" under a
portability request. Exporting them would create a security risk.

Every export writes one activity log entry (`user.data_exported`).

### Delete a user's account

Only a SUPER_ADMIN can start this action. Call
`requestUserDeletion(targetUserId, confirmText)`. The admin must type
`DELETE` as `confirmText`, or the action stops with an error.

A SUPER_ADMIN cannot delete their own account this way. This rule stops an
admin from locking themselves out.

**This action does not remove the database row.** It anonymizes the row in
place instead. The action changes the name to "Deleted User". It changes
the email to a tombstone value. It clears the phone number and avatar. It
sets the account status to `INACTIVE`.

The row stays because other tables point to it. Sales, activity logs, and
other records point to the user's ID. The database schema blocks a hard
delete of a user who has this kind of history. Removing the row would
break that history. Anonymizing the row keeps the history intact and
removes the person's identifying details.

The database has no `deletedAt` field on the user table. The activity log
entry this action writes (`user.deletion_requested`) is the permanent
record of when the deletion happened.
