# Phase 4 — Expiry & Batch/Lot Tracking: Architecture Audit

**Status:** Design / preflight only. No schema, migration, sales, inventory, or
UI changes were made in this audit. Do not implement based on assumptions —
resolve the *Open business decisions* (§15) with the user first.

**Feature flag:** `expiry_batch_enabled` already exists in
`src/lib/features.ts:15,22,29` (defaults `false`). Everything below is gated by
it **plus** a per-product opt-in, so simple stores/products are byte-for-byte
unchanged.

---

## 1. Current stock architecture (discovered from code)

### Source of truth today
- `Product.stock` — `Decimal(12,3)` (`prisma/schema.prisma:201`).
- `ProductVariant.stock` — `Decimal(12,3)` (`prisma/schema.prisma:256`).
- `Product.minimumStock` — `Decimal(12,3)` (`prisma/schema.prisma:204`).
- These aggregate columns are **the single authority**. There is no batch/lot
  concept anywhere in the schema today.

### Atomic oversell guard (must be preserved verbatim)
`src/lib/inventory.ts`:
- `decrementProductStock` (L12–22) / `decrementVariantStock` (L25–35):
  `tx.*.updateMany({ where: { id, stock: { gte: quantity } }, data: { stock: { decrement } } })`.
  The `gte` guard is inside the same UPDATE, so a concurrent loser gets
  `count === 0`. This is the invariant the whole design must not break.
- `incrementProductStock` (L38–47) / `incrementVariantStock` (L50–59): always
  succeed (returns, deletion).

### Sale write path — `createSale` (`src/actions/sales.ts:46–289`)
1. `getSessionContext()` → `can(role,"sale.create")` → `requireStoreId()`
   (L47–51) — the tenant chain the audit must keep.
2. Loads products **scoped by storeId** (L61–66); resolves each line to a
   concrete price + stock target (variant vs product) + variant label snapshot
   (L96–148). Decimal gating via `isValidQuantity` + `round3` (L101–105).
3. Friendly pre-check (L151–155) — *not* the real guard.
4. `prisma.$transaction` (L183–238): per line atomic decrement (L184–189) →
   `sale.count`-derived invoice + `sale.create` with nested `items.create`
   (L191–209) → one `InventoryMovement` per line (`type:"OUT"`, negative signed
   `quantity`, L211–223) → `logActivity(..., tx)` (L225–235).
5. Invoice-collision retry loop wraps the whole tx (L178–250, `MAX_INVOICE_ATTEMPTS=5`).
6. Low-stock notifications run **after** the tx, best-effort (L254–279): compares
   `Number(p.stock) <= Number(p.minimumStock)`.

### Return path — `returnSaleItems` (`src/actions/sales.ts:305–441`)
- Auth `sale.refund` + `requireStoreId` (L306–310). Validates returnable qty
  (`quantity - returnedQuantity`, decimal-aware, L327–351).
- `computeReturnAmounts` derives proportional discount/tax/refund/profit from the
  **SaleItem money snapshots** (L356–364) — batches must NOT touch this math.
- Tx (L373–430): `saleItem.returnedQuantity += qty` (L375–378) → restore stock to
  **variant or product** (L382–386) → `InventoryMovement type:"RETURN"` (L388–398)
  → rewrite sale money columns to net-of-returns (L401–412) → `logActivity`.

### Delete path — `deleteSale` (`src/actions/sales.ts:490–556`)
- Restores only **outstanding** units `quantity - returnedQuantity` per item
  (L505–526), writes RETURN movements, then `sale.delete` cascades items.

### Read models that consume aggregate stock
- POS: `getPOSProducts` (`src/lib/queries/sales.ts:32–66`) — variant card stock =
  **sum of variant stock** (L49); per-variant `Number(v.stock)` (L62).
- Dashboard: `unitsInStock = Σ Number(p.stock)` and
  `lowStockCount = Number(stock) <= Number(minimumStock)`
  (`src/lib/queries/dashboard.ts:87–88,150–153,200–204`).
- Products list/detail: `Number(stock)` / `Number(minimumStock)`
  (`src/lib/queries/products.ts:35–36,70–71,103`).

### Supporting facts
- `SaleItem` (`prisma/schema.prisma:473–500`): `quantity`/`returnedQuantity`
  `Decimal(12,3)`, price/cost/profit snapshots `Decimal(10,2)`, `variantLabel`
  snapshot. **No batch fields.**
- `InventoryMovement` (`:502–524`): `type MovementType`, signed `quantity`
  `Decimal(12,3)`, `variantId?`. `MovementType = IN | OUT | RETURN | ADJUSTMENT
  | SUPPLIER_DELIVERY | MANUAL_EDIT` (`:57–64`). **No batch field.**
- Money is `Decimal(10,2)`; quantities/stock `Decimal(12,3)`; helpers `round2`,
  `round3`, `isValidQuantity` in `src/lib/sale-math.ts`.
- Variant unique key is `@@unique([storeId, sku])` (`:275`); `variantId` is
  nullable across `SaleItem`/`InventoryMovement`.

---

## 2. Graft dependency findings

`graft build` / `graft check` were run — **1020 nodes, 2854 edges, graph in sync**
(0% deep tier is expected; the wiring graph is the source of truth). Findings:

- **`stock` fan-in:** the only *writers* are the four `src/lib/inventory.ts`
  helpers; the only *callers* of those helpers are `createSale`,
  `returnSaleItems`, `deleteSale` (`src/actions/sales.ts`) and the
  product/variant create/update actions (`src/actions/products.ts`,
  `src/actions/variants.ts`). → **A batch layer only has to intercept these
  choke points**; there is no scattered raw `stock` mutation to hunt down.
- **`stock` fan-out (readers):** `getPOSProducts`, `dashboard.ts`, `reports.ts`,
  `products.ts`. All read the **aggregate** column. → Keeping the aggregate
  authoritative-as-cache means **none of these read models change** for the core
  numbers (this is the decisive argument for source-of-truth Option C-cache, §3).
- **`InventoryMovement` writers:** only the three sales actions + product/variant
  edits → a nullable `batchId` on movements is a low-blast-radius addition.
- **No existing `expiry`, `batch`, `lot`, or `ProductBatch` symbol exists** —
  the feature is greenfield except for the reserved flag.
- **Tenant chain** (`getSessionContext` → `requireStoreId` /
  `requireStorePermission`) is used uniformly by every mutation; new batch
  actions must reuse it, not fork it.

---

## 3. Recommended source-of-truth model

**Recommendation: Option C, refined — "batches are the authoritative ledger for
tracked products; the existing `Product/ProductVariant.stock` aggregate is kept
as a transactionally-consistent cache."**

- **Untracked products** (`trackBatch = false`, the default and every existing
  product): **exactly Option A / today.** No batch rows, aggregate is authority,
  code path unchanged. Zero cost, zero risk.
- **Tracked products** (`trackBatch = true`): stock detail lives in
  `ProductBatch` rows. **Every** batch mutation also mutates the aggregate in the
  **same transaction**, maintaining the invariant:

  > `Σ ProductBatch.stock (status = ACTIVE)  ==  ProductVariant.stock` (or
  > `Product.stock` when no variant) — per product/variant, at every commit.

### Why this over pure Option B (derived aggregate)
| Criterion | C-cache (recommended) | B (derived) |
|---|---|---|
| **Concurrency** | Reuse the proven `updateMany … stock >= qty` guard at **both** batch-row and aggregate level. No negative possible. | Must re-derive + re-implement atomic guard over `SUM()`; harder, race-prone. |
| **Query complexity** | POS/dashboard/reports read aggregate unchanged. | Every read becomes a `GROUP BY` sum; rewrite all read models. |
| **Migration risk** | Additive only; aggregate columns keep their meaning. | Aggregate meaning changes; high-risk data migration. |
| **Reporting impact** | Existing reports untouched; new batch reports additive. | All reports re-validated. |
| **Oversell protection** | Preserved verbatim (aggregate) + per-batch guard. | Reimplemented. |

### Double source-of-truth risk — how it is resolved (see §"Important safety")
The aggregate and the batch sum are two counters, so they *could* drift. Resolved
by: (a) **only ever mutating them together inside one `$transaction`**; (b) a pure
allocation helper that guarantees `Σ allocations == line quantity`; (c) a
**reconciliation query** (Manager tool + test) that flags any product where
`Σ active-batch stock ≠ aggregate`; (d) enabling tracking backfills an
**Opening-stock batch** equal to the current aggregate so the invariant holds
from t=0 (§5).

---

## 4. Proposed Prisma models and indexes (NOT yet written to schema)

> Illustrative only — `prisma/schema.prisma` was **not** edited.

```prisma
enum BatchStatus { ACTIVE DEPLETED EXPIRED ARCHIVED }

model ProductBatch {
  id         String      @id @default(cuid())
  storeId    String
  store      Store       @relation(fields: [storeId], references: [id], onDelete: Restrict)
  productId  String
  product    Product     @relation(fields: [productId], references: [id], onDelete: Cascade)
  variantId  String?
  variant    ProductVariant? @relation(fields: [variantId], references: [id], onDelete: Cascade)
  batchCode  String
  expiryDate DateTime?   @db.Date        // date-only; null = batch-only tracking
  receivedAt DateTime    @default(now())
  stock      Decimal     @db.Decimal(12,3) @default(0)
  costPrice  Decimal?    @db.Decimal(10,2)
  status     BatchStatus @default(ACTIVE)
  metadata   Json?
  createdAt  DateTime    @default(now())
  updatedAt  DateTime    @updatedAt

  allocations SaleItemBatchAllocation[]
  movements   InventoryMovement[]

  @@index([storeId])
  @@index([productId, variantId, status])
  @@index([storeId, expiryDate])            // expiring-soon / expired scans
  // batchCode uniqueness: see nullable-variant note below (needs raw partial
  // unique indexes — Prisma @@unique treats NULL variantId as distinct).
  @@map("product_batches")
}

model SaleItemBatchAllocation {
  id               String   @id @default(cuid())
  saleItemId       String
  saleItem         SaleItem @relation(fields: [saleItemId], references: [id], onDelete: Cascade)
  batchId          String
  batch            ProductBatch @relation(fields: [batchId], references: [id], onDelete: Restrict)
  quantity         Decimal  @db.Decimal(12,3)   // units taken from this batch
  returnedQuantity Decimal  @db.Decimal(12,3) @default(0)
  createdAt        DateTime @default(now())

  @@index([saleItemId])
  @@index([batchId])
  @@map("sale_item_batch_allocations")
}
```

Additive fields on existing models (all nullable/defaulted → non-breaking):
- `Product.trackBatch  Boolean @default(false)`
- `Product.trackExpiry Boolean @default(false)`
- `InventoryMovement.batchId String?` (+ relation) — attribute a movement to a batch.
- `SaleItem.allocations SaleItemBatchAllocation[]` (back-relation only).

### Decisions embedded above
- **Unique constraints / nullable `variantId`:** PostgreSQL treats `NULL` as
  distinct in a unique index, so `@@unique([storeId, productId, variantId,
  batchCode])` would let duplicate **product-level** batch codes slip through.
  **Resolution (implementation note, needs raw SQL in the migration):** two
  *partial* unique indexes —
  `CREATE UNIQUE INDEX … ON product_batches (storeId, productId, batchCode) WHERE variantId IS NULL;`
  and `… (storeId, productId, variantId, batchCode) WHERE variantId IS NOT NULL;`.
  → **batchCode is unique per (store, product, variant)**, which is the right
  grain (two products may share code "2026-01"; the same product+variant may not).
- **`variantId` relationship:** batches attach at product **or** variant grain,
  matching how `SaleItem`/`InventoryMovement` already model `variantId?`. No
  separate variant-batch table.
- **Soft deletion:** yes — `status` (never hard-delete a batch referenced by a
  historical allocation; `onDelete: Restrict` on the allocation→batch relation
  enforces it). `DEPLETED` when `stock` hits 0; `EXPIRED` set by a sweep/read
  check; `ARCHIVED` for manual retire.
- **`expiryDate` nullable:** yes — supports batch/lot-only tracking (electronics
  serial/lot) with no expiry.
- **`trackExpiry` vs `trackBatch`:** two flags so a store can do lot tracking
  without dates, or dates without caring about lots (still needs batch rows to
  hold per-delivery dates → `trackExpiry` implies `trackBatch`).
- **ProductVariant-level tracking override:** **not** in MVP — track at product
  grain; batches already carry `variantId`. Revisit only if a real need appears.
- **Return records:** **no** separate table — reuse
  `SaleItemBatchAllocation.returnedQuantity` (mirrors `SaleItem.returnedQuantity`).

---

## 5. Sale allocation algorithm (FEFO, split, atomic)

**Default: automatic FEFO** (First-Expired-First-Out), **FIFO fallback** when
`expiryDate` is null (order by `receivedAt`). Sellers never pick batches for
ordinary products. One `SaleItem` may split across multiple batches →
`SaleItemBatchAllocation` rows. The design must guarantee **no batch and no
aggregate can go negative under concurrency.**

Eligible batches = `status = ACTIVE`, `stock > 0`, and (when the store blocks
expired sales — the default) `expiryDate IS NULL OR expiryDate >= today(storeTZ)`.

Ordering (FEFO→FIFO): `ORDER BY expiryDate ASC NULLS LAST, receivedAt ASC, id ASC`.

```
// inside the existing createSale $transaction, per tracked line:
async function allocateLine(tx, line):
  let need = round3(line.quantity)

  // 1) authoritative aggregate guard FIRST (cheap, reuses existing helper):
  const ok = line.variantId
    ? await decrementVariantStock(tx, line.variantId, need)   // where stock >= need
    : await decrementProductStock(tx, line.productId, need)
  if (!ok) throw new InsufficientStock(line.productName, line.available)

  // 2) draw the same quantity down across batches, FEFO order:
  const batches = await tx.productBatch.findMany({
    where: { storeId, productId: line.productId, variantId: line.variantId,
             status: "ACTIVE", stock: { gt: 0 },
             ...(blockExpired ? { OR: [{expiryDate:null},{expiryDate:{gte: todayStoreTz}}] } : {}) },
    orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }, { id: "asc" }],
  })
  const allocations = []
  for (const b of batches):
    if (need <= 0) break
    const take = round3(Math.min(need, Number(b.stock)))
    // atomic conditional decrement — loser of a race yields count 0, we skip/retry
    const res = await tx.productBatch.updateMany({
      where: { id: b.id, stock: { gte: take } },
      data: { stock: { decrement: take } },
    })
    if (res.count === 0) continue          // raced; try next batch
    allocations.push({ batchId: b.id, quantity: take })
    need = round3(need - take)

  if (need > 0):
    // aggregate had units but eligible batches don't (all expired/blocked or a
    // race drained them). Roll back the whole tx -> the outer invoice-retry loop
    // (sales.ts:181) re-reads fresh batch state on the next attempt.
    throw new InsufficientBatchStock(line.productName)   // NEW distinct error

  // 3) persist allocations + batched movements (see step in createSale)
  return allocations   // Σ quantity === line.quantity  (asserted by a pure helper)
```

Concurrency guarantees:
- **Aggregate** cannot go negative — existing `gte` guard (step 1).
- **No batch** can go negative — per-batch `updateMany … stock >= take` (step 2).
- **Aggregate ↔ batch consistency** — steps 1 and 2 move the *same* `need` in one
  tx; if batches can't cover it, the tx rolls back so *neither* side commits.
- **"Aggregate exists but eligible batches insufficient"** → explicit
  `InsufficientBatchStock` (distinct from `InsufficientStock`), surfaced to the
  cashier as "expired/blocked stock — ask a Manager", not a generic error.
- **Rounding across splits:** every `take` is `round3`; a pure
  `planAllocation(need, batches)` helper (unit-tested) guarantees
  `Σ take === need` with no 0.001 residue before any DB write.

Manager-explicit batch selection and Seller override are **config, default off**
(§7); the algorithm above is the default path.

---

## 6. Return restoration algorithm

Original allocation is recorded in `SaleItemBatchAllocation` at sale time.
**Default: restore to the exact original batch(es)**, proportionally for partial
returns, mirroring the existing `returnedQuantity` accounting. Refund math is
unchanged — it reads `SaleItem` money snapshots (`computeReturnAmounts`), fully
independent of batches.

```
// inside the existing returnSaleItems $transaction, per returned line:
async function restoreLine(tx, item, qty):
  // qty is already validated <= (item.quantity - item.returnedQuantity), round3
  const allocs = await tx.saleItemBatchAllocation.findMany({
    where: { saleItemId: item.id },
    orderBy: { createdAt: "asc" },          // give back in allocation order (LEFO optional)
  })
  let remaining = qty
  for (const a of allocs):
    if (remaining <= 0) break
    const canReturn = round3(Number(a.quantity) - Number(a.returnedQuantity))
    if (canReturn <= 0) continue
    const give = round3(Math.min(remaining, canReturn))
    await tx.saleItemBatchAllocation.update({
      where: { id: a.id }, data: { returnedQuantity: { increment: give } } })
    // restore to the ORIGINAL batch (still exists — batches are soft-deleted):
    await tx.productBatch.update({ where: { id: a.batchId },
      data: { stock: { increment: give },
              status: /* if was DEPLETED and now >0 */ "ACTIVE" } })
    await tx.inventoryMovement.create({ data: { …, type:"RETURN", quantity: give, batchId: a.batchId } })
    remaining = round3(remaining - give)

  // aggregate restore stays exactly as today (variant vs product):
  if (item.variantId) await incrementVariantStock(tx, item.variantId, qty)
  else await incrementProductStock(tx, item.productId, qty)
  // then existing sale money-column rewrite (unchanged)
```

Edge cases:
- **Original batch expired/archived:** it still *exists* (soft delete) → restore
  to it; it stays `EXPIRED`/`ARCHIVED` so it won't be re-sold by FEFO. A revived
  DEPLETED batch flips back to `ACTIVE` only if not expired/archived.
- **Original batch "deleted":** disallowed — `SaleItemBatchAllocation.batch` uses
  `onDelete: Restrict`, so a batch with allocations can never be hard-deleted.
- **Manager chooses a different return batch:** optional override (Manager only,
  audited) — restore `qty` to a chosen batch instead of the original; allocation
  `returnedQuantity` still advances so accounting stays closed. Default = original.
- **Fractional/partial:** `round3` throughout; `Σ allocation.returnedQuantity`
  can never exceed `SaleItem.returnedQuantity`.
- **`deleteSale`:** for each item, restore **outstanding** (`quantity -
  returnedQuantity`) across its still-open allocations by the same loop; then the
  allocation rows cascade with the SaleItem on `sale.delete`.

---

## 7. Stock-receiving workflow (Manager)

Minimum Manager actions, each a `$transaction`, tenant-scoped from session
(`requireStorePermission` — reuse the catalog gate or a new `inventory.manage`),
**never trusting a client storeId**, validating product/variant ∈ store:

1. **Enable tracking** on a product (`trackBatch`/`trackExpiry`). If current
   aggregate stock > 0 → auto-create an **"Opening stock" batch**
   (`batchCode="OPENING"`, `expiryDate=null`, `stock=currentAggregate`,
   `costPrice=product.fabricationPrice`), so `Σbatches == aggregate` immediately.
   **Recommended: yes** — this is what keeps the invariant true from t=0.
2. **Create / receive a batch:** insert `ProductBatch` + `aggregate += stock` +
   `InventoryMovement(type:"SUPPLIER_DELIVERY", quantity:+stock, batchId)` +
   `logActivity`.
3. **Adjust batch stock:** delta applied to batch + aggregate together +
   `InventoryMovement(type:"ADJUSTMENT", batchId)` + activity.
4. **Record expiry / batchCode / pick variant:** fields on create/edit; variant
   select validated against the product's own variants in-store.
5. **Cross-store guard:** every write filters `productId`/`variantId` by the
   session `storeId` before mutating (mirrors `createSale` L61–66).

---

## 8. Tenant & permission model

- Reuse the existing chain unchanged: `getSessionContext()` → `can(role, perm)` /
  `requireStorePermission(perm)` → `requireStoreId()` → all Prisma scoped by the
  **session** `storeId`. No client-supplied store scope, ever (matches
  `src/lib/store-context.ts`, `src/lib/rbac-guards.ts`).
- **Permission:** add `inventory.manage` to `MANAGER` in
  `src/lib/rbac.ts` (batch receiving/adjust/enable-tracking). Sellers keep only
  `sale.create` — FEFO allocation is automatic and server-side.
- **Selling expired stock override:** a Manager-only capability (e.g.
  `inventory.overrideExpiry`), audited; Sellers never get it (default security).
- Batches inherit store scope via `storeId` + the product/variant relation; every
  new query filters by `storeId`.

---

## 9. Feature-gated UI plan

Gated by `expiry_batch_enabled` **and** per-product `trackBatch`; nothing appears
for stores/products that don't opt in.

**Manager**
- Product form: a "Batch & expiry tracking" toggle (only when the store flag is
  on) — sits beside the existing Units/Specs cards, product form stays generic.
- Product detail: a **Batches** section (list: code, expiry, stock, status,
  value) + "Receive stock" dialog.
- Optional `/inventory/batches` page (store-wide) with an **Expiring soon** view
  and **Expired** warnings; nav item feature-gated like `/variant-axes`.
**Seller (POS)**
- **No batch controls** for ordinary products. FEFO allocation is invisible.
- Batch/expiry detail shown only when relevant (e.g. "nearest expiry: 2026-10").
- Clear messages: out-of-stock vs "only expired stock — ask a Manager".

---

## 10. Reports & notification impact

- **Do not touch** existing dashboard/report queries for stores with the flag
  off — they keep reading the aggregate (`dashboard.ts:87–88`, `products.ts`,
  `getPOSProducts`). New batch queries run **only** when `expiry_batch_enabled`.
- New (flag-gated) reports/notifications: **Expiring in 7/30/60 days**, **Expired
  stock**, **Stock value by batch** (`Σ stock * costPrice`), **Batch history**
  (from `InventoryMovement.batchId`).
- **Low-stock for tracked products** stays on the aggregate (`stock <=
  minimumStock`) — unchanged and correct because the aggregate is maintained.
- New notification type `EXPIRING_SOON` / `EXPIRED` (extends the existing
  `Notification` pattern used by `createSale` L265–275), emitted by a scheduled
  sweep or on read; Manager recipients only.

---

## 11. Migration & backward-compatibility plan

- **All additive:** new tables (`ProductBatch`, `SaleItemBatchAllocation`), new
  nullable/defaulted columns (`trackBatch`,`trackExpiry`,`InventoryMovement.batchId`).
  No change to `Product.stock`/`ProductVariant.stock` meaning or type.
- **Migration order:** (1) create enum + tables + columns; (2) create the two
  **partial unique indexes** via raw SQL (§4 nullable-variant note); (3) deploy —
  feature is dormant (`expiry_batch_enabled` false everywhere, `trackBatch`
  false). No backfill at migrate time.
- **Backfill:** lazy, **per product**, only when a Manager enables tracking →
  Opening-stock batch (§7.1). Existing stores see nothing.
- **Rollback:** because it ships dormant, rollback = drop the new tables/columns;
  no data reinterpretation. Once batches exist, rollback needs the disable path
  below.
- **Disabling tracking while batch stock exists (open decision, §15):**
  recommended default — allowed; on disable, archive the product's batches
  (`status=ARCHIVED`) and keep the aggregate as-is (it already equals Σbatches),
  so the product cleanly reverts to Option-A behavior with no stock jump. Block
  disable only if it would violate the invariant.
- **Reconciliation:** a Manager/CLI check `Σ active-batch stock == aggregate` per
  tracked product, to catch drift after any incident.

---

## 12. Phase 4a / 4b / 4c sequence (AMENDED — see the invariant finding)

> **Audit finding that changes the suggested split:** shipping "4a = receiving &
> batch management, no POS allocation" as originally proposed is **unsafe**. The
> moment a tracked product is sold, `createSale` decrements only the aggregate
> (`inventory.ts`), so `Σbatches` would stop equalling the aggregate — a silent
> double-source-of-truth divergence. Therefore **sale allocation must ship in the
> same release that lets a sellable product become tracked.**

**Phase 4a — Foundations + receiving + FEFO sale allocation (atomic, one release)**
- Schema: models/columns/indexes (§4); `prisma migrate`.
- Pure helpers (unit-tested, no DB): `planAllocation(need, batches)`,
  `isEligibleBatch(batch, todayStoreTz, blockExpired)`, FEFO comparator, batch
  status transitions, reconciliation sum.
- Manager receiving/adjust/enable-tracking + Opening-stock backfill (§7).
- `createSale` integration: FEFO allocation + `SaleItemBatchAllocation` +
  batched `InventoryMovement`, gated by `trackBatch` (untracked path unchanged).
- **Ships coherent:** enabling tracking is only exposed once sales honor it.

**Phase 4b — Batch-aware returns & deletion**
- `returnSaleItems` + `deleteSale` restore to original batches via allocations
  (§6). (Between 4a and 4b, returns for tracked products still restore the
  aggregate correctly via the existing path; batch-level restoration is the
  added precision — acceptable interim, but 4b should follow closely.)

**Phase 4c — Expiry enforcement, reports & notifications**
- Block-expired-sale default + Manager override; store warning window + timezone.
- Expiring/expired reports, stock-value-by-batch, batch history, `EXPIRING_SOON`
  notifications; expiring-soon UI.

---

## 13. Test strategy

- **Pure (vitest, no DB)** — the bulk, following `sale-math.test.ts` /
  `catalog-templates.test.ts` style:
  - `planAllocation`: exact cover, split across batches, `Σtake === need`, no
    0.001 residue, decimal + integer-fallback, insufficient → error.
  - FEFO/FIFO ordering incl. null-expiry fallback and tie-breaks.
  - eligibility: expired excluded when blocking; today = still sellable.
  - reconciliation helper: detects Σbatches ≠ aggregate.
- **Transaction/integration (DB)** — mirror the existing live-proof style:
  - concurrent sales on one batch never drive batch or aggregate negative;
  - aggregate-exists-but-batches-insufficient → `InsufficientBatchStock`, tx rolls
    back, nothing committed;
  - partial fractional return restores the exact original batch;
  - Opening-stock backfill makes `Σbatches == aggregate`;
  - untracked product path is byte-for-byte unchanged (regression guard).

---

## 14. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Double source of truth (aggregate vs Σbatches) | Mutate both in one tx; pure `planAllocation` guarantees Σ; reconciliation check + test; Opening-stock backfill. |
| Batch allocation race → negative | Per-batch `updateMany … stock >= take`; aggregate `gte` guard; whole-tx rollback + existing invoice retry loop re-reads. |
| Nullable `variantId` unique holes | Two **partial** unique indexes (raw SQL), per-(store,product[,variant]) grain. |
| Decimal residue over splits | `round3` every `take`; Σ-asserting helper before writes. |
| Selling expired stock | FEFO excludes expired by default; Sellers can't override; Manager override audited. |
| Deleting a batch used by history | `onDelete: Restrict` on allocation→batch; soft-delete via `status` only. |
| Perf regression for flag-off stores | New queries strictly gated by `expiry_batch_enabled`; existing reads untouched; add `[storeId, expiryDate]` + `[productId, variantId, status]` indexes. |
| TZ boundary on "expiring today" | `@db.Date` expiry compared against store-TZ "today"; store-level timezone setting. |
| Interim divergence if 4a shipped without allocation | **Resolved** by folding FEFO allocation into 4a (§12). |
| `deleteSale` on tracked sale | Restore outstanding across open allocations before cascade (§6). |

---

## 15. Open business decisions requiring user confirmation

1. **`batchCode` grain:** confirm per-(store, product, variant) uniqueness (audit
   recommendation) vs per-store or per-product.
2. **Expired-sale policy:** confirm Sellers are hard-blocked and only Managers may
   override (recommended). Configurable warning window default (7/30/60)?
3. **Timezone source:** add a store-level timezone setting for date-only expiry
   evaluation? (Today there is none — currency/tax only.)
4. **Disabling tracking with live batch stock:** archive-batches-keep-aggregate
   (recommended) vs hard-block until depleted.
5. **Manager return-batch override:** ship it in 4b or defer? (Default = restore
   original.)
6. **Explicit Seller batch selection:** keep permanently off (recommended) or
   expose as an optional per-store setting later?
7. **`inventory.manage` permission:** new permission for MANAGER (recommended) vs
   reuse `category.manage`.
8. **COGS/costPrice usage:** is batch `costPrice` for reporting only now, or
   should future sales snapshot batch cost into `SaleItem.fabricationPrice`
   (changes profit math — out of scope unless confirmed)?

---

## 16. Exact files expected to change per phase (forecast — none changed in this audit)

**Phase 4a**
- `prisma/schema.prisma` (+ new migration incl. raw partial unique indexes)
- `src/lib/features.ts` (no change — flag exists) / possibly `src/lib/validations/settings.ts` if a warning-window/timezone setting lands here
- `src/lib/rbac.ts` (+`inventory.manage`)
- `src/lib/batches.ts` **(new, pure)** — `planAllocation`, FEFO comparator,
  eligibility, status transitions, reconciliation
- `src/lib/batches.test.ts` **(new)**
- `src/lib/inventory.ts` (+ batch decrement/increment helpers, same guard pattern)
- `src/actions/batches.ts` **(new)** — create/receive/adjust/enable-tracking
- `src/actions/products.ts` (persist `trackBatch`/`trackExpiry`; Opening-stock backfill on enable)
- `src/actions/sales.ts` (`createSale`: FEFO allocation for tracked lines)
- `src/lib/queries/batches.ts` **(new)**; `src/lib/queries/products.ts` (surface tracking flags)
- `src/lib/validations/batch.ts` **(new)**
- UI: `src/components/products/product-form.tsx` (tracking toggle),
  product detail batch section, `src/components/inventory/*` **(new)**,
  `src/app/(dashboard)/inventory/batches/*` **(new)**, `src/lib/nav-config.ts`,
  `src/components/layout/app-sidebar.tsx`

**Phase 4b**
- `src/actions/sales.ts` (`returnSaleItems`, `deleteSale`: batch restoration)
- `src/lib/queries/sales.ts` (surface allocations to the return dialog)
- `src/components/sales/sale-actions.tsx` (optional Manager return-batch override)
- `src/lib/batches.ts` / tests (restoration helpers)

**Phase 4c**
- `src/lib/queries/dashboard.ts`, `src/lib/queries/reports.ts`,
  `src/app/api/reports/export/route.ts` (expiring/expired/value-by-batch — flag-gated)
- `src/actions/sales.ts` (expired-sale block + Manager override)
- notifications: `src/actions/notifications.ts` / a scheduled sweep;
  `prisma/schema.prisma` (Notification type enum +EXPIRING_SOON/EXPIRED)
- `src/lib/validations/settings.ts` + settings UI (warning window / timezone)
- expiring-soon UI views

---

### Bottom line
Ship **Option C-cache** (batches authoritative for tracked products, aggregate
maintained as a consistent cache), fold **FEFO sale allocation into 4a** (do not
ship receiving without it), and preserve every existing invariant by mutating
aggregate + batch **together atomically** with the proven `updateMany … stock >=
qty` guard at both levels. The largest concurrency risk is aggregate↔batch
divergence, resolved structurally by single-transaction co-mutation + a pure
Σ-guaranteeing allocator + reconciliation. Resolve §15 with the user before any
code.
