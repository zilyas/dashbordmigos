# Multi-vertical platform — phase tracker

Core + Extensions model. Advanced capabilities gated by per-store feature flags
(`store.features` JSON). Backward-compatible; simple stores unaffected.

## ✅ Variant slice (earlier) — SHIPPED
Size/Color/ProductVariant, atomic oversell guard (`src/lib/inventory.ts`), pure
tested money math (`src/lib/sale-math.ts`), R2 storage, vitest suite.

## ✅ Phase 1a — feature flags + units field + search — FULLY CLOSED
- [x] `store.features` JSON + `src/lib/features.ts` (getStoreFeatures + is*Enabled helpers)
- [x] Flag toggles: Manager (Settings) + Super Admin (store dialog)
- [x] `Product.unit` + `Product.allowDecimalQuantity` + `@@index([storeId,name])`
- [x] Product form Units card (only when units_enabled)
- [x] `src/lib/text.ts` accent-insensitive search helper (normalize/matchesAny)
- [x] Search UI wired: POS accent-insensitive `matchesAny`; products-table unit +
      has-variants filters; Sizes/Colors filter boxes

## ✅ Phase 1a/1b follow-ups
- [x] minimumStock → Decimal(12,3) (migration 20260907220802), gated like stock
- [x] partial fractional returns: return dialog decimal input + action allows fractional
      lines; test added (0.3 of 1.2 → 0.9 outstanding)

## ✅ Phase 1b — decimal quantities
- [x] Migration Int→Decimal(12,3): Product.stock, ProductVariant.stock,
      SaleItem.quantity/returnedQuantity, InventoryMovement.quantity
- [x] `round3` + `isValidQuantity` in sale-math (tested)
- [x] Gate: decimals only when store units_enabled AND product allowDecimalQuantity;
      integer fallback everywhere else (no change for piece products)
- [x] sales action (create/return/delete) decimal-aware; atomic guard preserved
- [x] products/variants actions enforce integer-or-decimal policy on stock
- [x] queries convert Decimal→Number at the boundary (products, sales, dashboard, stores)
- [x] POS decimal quantity input (per-line) + product/variant form decimal stock step
- [x] seed: DEMO store units_enabled + "Farine (au kg)" decimal product (stock 25.5)
- [x] tests 29/29; tsc/eslint/next build --webpack green; E2E decimal stock verified live

## Tooling
- [x] `postinstall`/`predev`/`prebuild` run `prisma generate` (drift guard) + README note
- [x] Removed stray `project/graft` cache

## ✅ Phase 2 — category attributes
- [x] Schema: `CategoryAttributeDefinition` + `ProductAttributeValue` (migration
      20260908002634), AttributeType enum, unique (categoryId,key) & (productId,definitionId)
- [x] `src/lib/attributes.ts` pure helpers (validate/coerce/format) + tests (9 cases)
- [x] validations `category-attribute.ts`; actions `category-attributes.ts` (def CRUD,
      Manager-scoped); product values persisted in `products.ts` (gated by flag)
- [x] queries: `getCategories` includes definitions; `getProductById` includes values
- [x] UI: per-category "Manage attributes" dialog (NOT tabs on CategoryDialog); product
      form "Specifications" section (renders per definition, flag-gated)
- [x] seed: DEMO category_attributes_enabled + Marque/Matière on Vêtements
- [x] tsc/eslint/tests(39)/build green; E2E value persist + unique verified; flag-off hides UI

## ✅ Phase 3 — custom variant axes
- [x] Schema: `VariantAxisDefinition` (store-scoped) + `ProductVariant.axisValues Json?`
      (migration 20260908125914); sizeId/colorId kept unchanged. JSON chosen over a
      relational table (documented in schema) — axis values are simple display labels,
      unlike Phase 2's typed `ProductAttributeValue`.
- [x] `src/lib/variant-axes.ts` pure helpers (parse/order/validate) + `variantLabelFromParts`
      in sale-math; `variantLabel` extended with optional axis values (Size/Color-only unchanged)
- [x] validations `variant-axis.ts` + `variantSchema.axisValues`; actions `variant-axes.ts`
      (CRUD, Manager-scoped); variants create/update validate keys vs active axes (flag-gated)
- [x] queries: getProductVariants + getPOSProducts surface/label axis values; createSale label
- [x] UI: `/variant-axes` manager page (flag-gated nav via `navItemsForRole(role, features)`);
      VariantManager renders custom-axis inputs; POS/receipt labels include axes
- [x] seed: DEMO custom_variant_axes_enabled + "Coupe" axis (Slim/Regular) on T-shirt variants
- [x] tsc/eslint/tests(48)/build green; E2E label build verified; flag-off = no new UI

## ✅ Cross-phase integration check
- [x] Seeded ONE combined product "Pull Combiné (au kg)" (DEMO-COMBO): decimal quantity
      (Phase 1b) + Size/Color + custom "Coupe" axis (Phase 3) variants + category attribute
      values Marque/Matière (Phase 2), on the flag-enabled DEMO store.
- [x] Traced/verified the full path (no assumptions): product-form+variant-manager render
      units/axis/specs together; variantLabel combines to "S / Noir / Slim" (no dup);
      getPOSProducts + POS decimal input; createSale decimal+variant+atomic guard + label
      snapshot; returnSaleItems partial fractional return on an axis variant; receipt label.
- [x] E2E proven: sell 1.5 kg (stock 5.5→4.0), snapshot "S / Noir / Slim", totals 135/27/162
      profit 90; return 0.5 → stock 4.5, remaining 1.0, refund 54; attrs present.
- [x] NO interaction bugs found — extensions compose cleanly by design.
- [x] Regression test added (sale-math.test.ts): combined label + decimal totals + partial
      fractional return. tsc/eslint/tests(51)/build green.

## ✅ Security hardening pass (two long-standing risks, unrelated to multi-vertical work)
- [x] **CSV formula injection** — extracted `csvEscape` from `src/app/api/reports/export/route.ts`
      into a pure, tested `src/lib/csv.ts`. Text cells starting with `=`/`+`/`-`/`@` (after
      trimming) are prefixed with `'` so spreadsheets treat them as literal text; existing
      quote/comma/newline escaping is unchanged. **Real `number` cells are never neutralised**
      (a `-5` profit stays numeric — injection only arrives via strings). Route now imports the
      shared helper. Tests: `src/lib/csv.test.ts` (8 cases: structural + formula guard + negatives).
- [x] **Rate limiter abstraction + Redis path** — reworked `src/lib/security/rate-limit.ts`
      behind an async `RateLimiterBackend` interface (`limit`/`reset`). Default stays the
      in-memory fixed-window (now `InMemoryRateLimiter`, byte-for-byte same logic). A **real,
      fully-implemented** `UpstashRateLimiter` (Upstash Redis REST via `fetch`, atomic
      INCR+PEXPIRE+PTTL EVAL — **no new dependency**) activates only when BOTH
      `RATE_LIMIT_REDIS_REST_URL` and `_TOKEN` are set; otherwise nothing changes. Fails open
      with a logged error on Redis outage (DB account-lockout remains the brute-force backstop).
      Call sites (`auth.ts` login + reset, `password-reset.ts`) now `await` the async API.
      Documented in `.env.example` + `README.md` (Rate limiting section).
- [x] Validation: `tsc` clean · tests **59/59** (8 new CSV) · `build --webpack` green · eslint
      clean on touched files. No-Redis path = identical behaviour (in-memory backend selected).
- Redis was **fully implemented** (not scaffolded); dependency-free (fetch REST). Not runtime-
      verified against a live Upstash instance (no infra) — code path is opt-in and untouched
      unless the env vars are set.

## ✅ Cross-vertical product form UX pass
- [x] Reorganized create/edit product into progressive sections: identity, selling model,
      category specifications, pricing/inventory, optional legacy details, and images.
- [x] Replaced clothing/manufacturing-first wording with vertical-neutral labels and examples
      covering clothing, grocery, electronics, cosmetics, and general retail.
- [x] Advanced controls remain feature-gated; base stock is hidden for variant products and
      legacy Type/Size/Color fields are collapsed for simple products.
- [x] No schema, action payload, permission, or tenant-scoping changes.

## ✅ Store Starter Templates (MVP) — SHIPPED
- [x] **Pure module** `src/lib/catalog-templates.ts` — 5 typed templates (general-retail,
      clothing, grocery, electronics, cosmetics): stable key, name, description, required
      feature flags, categories (+ optional parent tree + isClothing), category attribute
      defs, optional custom variant axes, optional standard sizes/colors. **No DB table.**
      Client-safe (type-only imports of StoreFeatures/AttributeType). Pure helpers:
      `getCatalogTemplate`, `templateCategorySlug/AttributeKey/AxisKey`, `mergeFeatures`
      (enable-only, never disable), `featuresNewlyEnabled`.
- [x] **Server action** `src/actions/catalog-templates.ts` → `applyCatalogTemplate(key)`.
      Auth chain reused: `requireStorePermission("category.manage")` → session-derived
      storeId (MANAGER-only; SUPER_ADMIN has no storeId → rejected; never trusts client
      storeId). Validates key server-side. **Single `$transaction`**; additive & idempotent
      — every write guarded on stable slug/[storeId,key] uniques (findFirst/findUnique →
      reuse or create); template attributes are `required:false` so they can't invalidate
      existing products; features merged enable-only, unrelated keys preserved. Returns a
      created/reused/featuresEnabled summary. `logActivity(..., tx)` audit entry
      `catalog.templateApplied`. Revalidates settings/categories/products/sizes/colors/
      variant-axes.
- [x] **UI** `src/components/settings/starter-catalog-card.tsx` + wired into
      `src/app/(dashboard)/settings/page.tsx` (Manager-only route). Optional card, 5 choices,
      **preview dialog** (features to enable, categories/attrs/axes/sizes/colors, "no products
      or stock" note), explicit **Apply** confirm, success screen (created/reused/features).
      Collapses under a `<details>` once the store already has categories (advanced/onboarding).
      Template selection is NOT in the product form (product form stays generic).
- [x] **Tests** `src/lib/catalog-templates.test.ts` (14 cases) — unique keys; unique category
      slugs/attr keys/axis keys; parent refs valid; respects real validation limits (SELECT
      options, lengths, hex); no product/stock/sale/user fields; mergeFeatures preserves +
      enable-only + idempotent; unknown key rejected.
- [x] **Docs**: README §5c (what each template configures, optional/non-destructive/no
      products, how to build a custom catalog instead).
- [x] **Validation ALL GREEN**: prisma generate · tsc 0 errors · vitest **73/73** ·
      `eslint .` 0 errors (4 pre-existing warnings) · `build --webpack` · graft build · graft
      check (in sync).
- Idempotency: stable slug/key existence checks → reuse; second run = all reused, no dupes,
  features unchanged. Tenant isolation: storeId only from session; catalog.manage gate.
- Limitations: SUPER_ADMIN cannot apply templates (no per-store flow built — out of MVP
  scope; would need an explicitly authorized store-management path). Preview shows what the
  template *configures*, not a per-record created/reused diff (that's shown after applying).

## ✅ Phase 4a — expiry/batch DORMANT FOUNDATION — SHIPPED (schema + helpers only)
Design: [phase4-expiry-batch-design.md](./phase4-expiry-batch-design.md).
- [x] **Schema** (migration `20260909002131_phase4a_batch_foundation`, applied to Neon):
      `BatchStatus` enum; `ProductBatch` (storeId/productId/variantId?/batchCode/
      expiryDate `@db.Date`/receivedAt/stock Dec(12,3)/costPrice?/status/metadata) +
      `SaleItemBatchAllocation` (saleItemId/batchId/quantity/returnedQuantity);
      `Product.trackBatch`+`trackExpiry` (**default false**), `ProductVariant.batches`,
      `InventoryMovement.batchId?`, Store/SaleItem back-relations.
- [x] **Additive & dormant:** no existing stock/quantity column changed, no backfill,
      no batches created, existing products get trackBatch/trackExpiry=false. Verified
      in DB: both defaults `false`.
- [x] **Nullable-variant uniqueness:** two **partial** unique indexes in the migration
      SQL (verified live) — `(storeId,productId,batchCode) WHERE variantId IS NULL` and
      `(storeId,productId,variantId,batchCode) WHERE variantId IS NOT NULL`. Batch code
      unique per (store, product, optional variant).
- [x] **Deletion safety:** allocation→batch `onDelete: Restrict` (a batch referenced by
      sold history can never be hard-deleted); allocation→saleItem `Cascade`; movement→
      batch `SetNull`; batch→product/variant `Cascade`, batch→store `Restrict`. No
      cascade can silently remove allocation history.
- [x] **Pure helpers** `src/lib/batches.ts` (no Prisma/auth/server imports; reuses
      `round3`): `compareBatchesFEFO`/`sortBatchesFEFO`, `planBatchAllocation` (decimal-
      safe split, skips ≤0 stock, `{ok:false,shortfall}`, throws on bad request, no
      mutation), `batchStockTotal`, `reconcileBatchStock`, `deriveBatchStatus`
      (TZ-independent), `isBatchTrackingConfigurationValid` (trackExpiry⇒trackBatch),
      `normalizeBatchQuantity`. Local `BatchLike`/`BatchStatus` types keep it client-safe.
- [x] **Tests** `src/lib/batches.test.ts` (27 cases): FEFO ordering + null/receivedAt/id
      tiebreaks + no-mutation; allocation exact/split/1.275/0.001/zero+negative-skip/
      insufficient/sum-equals/no-overdraw/deterministic/no-mutation/throws; reconciliation
      equal/±drift/float-noise/empty; config validity; ARCHIVED/DEPLETED/EXPIRED derivation.
- [x] **Validation ALL GREEN:** prisma format/validate/generate · tsc 0 · vitest **100/100**
      (+27) · eslint 0 errors · build --webpack · graft build/check in-sync. Migration
      **applied** (not just generated).
- **Still dormant on purpose:** no UI, no actions, no tracking toggle, no sale/return/
      delete integration. Nothing can enable per-product tracking yet.

## ✅ Phase 4b — OPERATIONAL batch tracking — SHIPPED (one coherent release)
Batch tracking is now ACTIVE (expiry still dormant). No new migration needed — the
4a foundation schema was sufficient. All stock paths update aggregate + batch stock
together in one transaction, preserving `SUM(batch stock) == aggregate`.
- [x] **RBAC**: `inventory.manage` permission → MANAGER only (`src/lib/rbac.ts`).
- [x] **Validations** `src/lib/validations/batch.ts`: enable / receive / adjust (trim + length,
      positive receive qty, non-negative counted stock; decimal policy enforced server-side).
- [x] **Pure helpers** `src/lib/batches.ts` extended: `planReturnRestoration`,
      `planDeletionRestoration` (over-return guard, missing/inconsistent detection); relaxed
      `batchStockTotal`/`reconcileBatchStock` to `{stock}` inputs. `src/lib/inventory.ts`:
      `decrementBatchStock` (atomic `updateMany … status=ACTIVE AND stock>=qty`), `incrementBatchStock`.
- [x] **Actions** `src/actions/batches.ts` (all `inventory.manage` + `expiry_batch_enabled` gated,
      session storeId, `$transaction`, reconciliation asserted pre-commit):
      `enableProductBatchTracking` (atomic false→true flip + OPENING backfill, idempotent/
      concurrency-safe), `receiveBatchStock` (new/existing code, revive DEPLETED, block ARCHIVED,
      P2002-safe), `adjustBatchStock` (absolute counted qty, lost-update + negative guards),
      `getBatchReconciliation` / `reconcileStoreBatchInventory` (read-only, never auto-repair).
- [x] **Sales integration** `src/actions/sales.ts`: `createSale` FEFO allocation for tracked
      lines (aggregate + per-batch atomic decrement, DEPLETED marking, `SaleItemBatchAllocation` +
      per-batch movements, sum + reconcile checks, friendly conflict retry); `returnSaleItems` &
      `deleteSale` restore exact original batches via allocations (pre-tracking sales keep legacy
      path). Refund/profit math untouched (SaleItem snapshots; batch costPrice never affects money).
- [x] **Product/variant guards**: `updateProduct`/`updateVariant` reject direct stock edits when
      `trackBatch`; `createVariant` requires zero initial stock on tracked products.
- [x] **Queries** `src/lib/queries/batches.ts`: `getProductBatchView` (+ per-variant reconciliation),
      `getStoreBatchReconciliation`; `getProductById` surfaces `trackBatch`.
- [x] **UI** `src/components/products/batch-manager.tsx` below ProductForm/VariantManager on the
      edit page (feature-gated): Enable card (confirmation, "current stock → OPENING", "can't disable"),
      Batch inventory section (receive form, per-batch adjust dialog w/ reason, reconciliation
      indicator). No expiry fields, no Seller controls, no hard-delete/disable. Product form stays generic.
- [x] **Tests**: `src/lib/batches.test.ts` extended → **111/111** total (added return/deletion
      restoration cases). **Live DB proof (isolated temp store, cleaned up): 18/18 PASS** — opening
      reconcile, receive, FEFO split sell (12 = 10+2), OPENING→DEPLETED, oversell rejected + no
      change, partial return revives OPENING, delete restores outstanding to exact batches, final
      reconcile, partial-unique-index duplicate rejection.
- [x] **Validation ALL GREEN**: prisma validate/generate · tsc 0 · vitest 111/111 · eslint 0 errors
      (5 pre-existing warnings) · build --webpack · graft build/check. No migration created (4a schema sufficient).

## ✅ Phase 4c1 — expiry-safe activation & enforcement — SHIPPED
Expiry dates + expired-stock blocking now active (reports/notifications remain 4c2).
- [x] **Schema/migration** `20260909132937_phase4c1_store_timezone` (applied): additive
      `Store.timezone String @default("UTC")`; existing stores → UTC, no stock/batch/product
      change, no auto-trackExpiry.
- [x] **Pure `src/lib/timezone.ts`** (deterministic, injectable now, no browser/Prisma):
      `isValidIanaTimezone`, `getDateKeyInTimezone`, `getTodayInTimezone`, `toDateKey`
      (date-only, no shift), `compareDateOnly`, `isExpiredOnDate` (today = sellable),
      `daysUntilExpiry`, `COMMON_TIMEZONES`.
- [x] **Pure batch expiry helpers** (`src/lib/batches.ts`): `batchExpiryState`,
      `isBatchSellable`, `filterSellableBatches`, `validateExpiryTrackingActivation`,
      `isValidDateKey`; `deriveBatchStatus` takes a computed expired flag. Timezone maths kept
      separate from allocation.
- [x] **Settings**: `Store.timezone` in validation (IANA-validated) / query / action / form
      (curated `Select`, preserves features + other fields; Manager-scoped).
- [x] **Actions** (`src/actions/batches.ts`): `enableProductExpiryTracking` (atomic
      false→true, requires dates for all positive batches, rejects past/foreign/dup/missing,
      idempotent), `updateBatchExpiryDate` (no past date for stocked batch; logs old→new),
      `markExpiredBatches` (status-hygiene only, no stock/alloc change, quiet when no-op).
      `receiveBatchStock` now requires a valid non-past date for trackExpiry (existing code
      must match its date — never silently changed). `adjustBatchStock` uses status precedence
      ARCHIVED > 0→DEPLETED > expired→EXPIRED > ACTIVE and won't revive expired.
- [x] **Sales** (`src/actions/sales.ts`): `createSale` resolves store-local today once,
      filters to sellable (ACTIVE + stock>0 + dated + not-expired) via the pure helper (never
      trusts status alone; never allocates null-date), FEFO order, distinct
      *"Insufficient non-expired stock"* error with full rollback. Returns/`deleteSale` restore
      the exact original batch but keep it EXPIRED (new `reviveRestoredBatch` only revives
      non-expired DEPLETED). Reconcile guard now counts non-archived (incl. EXPIRED) stock.
- [x] **Queries/UI**: `getProductBatchView` surfaces `trackExpiry`, `storeToday`, per-batch
      `expiryDate` + `expiryState`. BatchManager: Enable-expiry card (date per positive batch),
      expiry column + Valid/Expires-today/Expired/No-date badges, required date in receive form,
      per-batch date-correction dialog. No expiry fields in the generic ProductForm; no Seller
      controls. Money math untouched.
- [x] **Tests**: `src/lib/timezone.test.ts` (new) + expiry eligibility/activation in
      `batches.test.ts` → **137/137**. **Live proof (isolated temp store, cleaned up): 16/16
      PASS** — FEFO excludes expired, expiring-today sellable, aggregate-sufficient-but-non-
      expired-insufficient rolls back, return to an expired batch stays EXPIRED, reconcile holds.
- [x] **Validation ALL GREEN**: prisma format/validate/generate · tsc 0 · vitest 137/137 ·
      eslint 0 errors (4 pre-existing warnings) · build --webpack · graft build/check.

## ✅ Phase 4c2 — expiry reporting & notifications — SHIPPED
Report, CSV export, deduplicated notifications, sweep service, and a secure daily cron —
all additive; core sale/return/deletion/receiving/allocation logic unchanged.
- [x] **Schema/migration** `20260910003425_phase4c2_expiry_notifications` (applied): additive
      NotificationType `EXPIRING_STOCK`/`EXPIRED_STOCK`, nullable `Notification.dedupeKey`, and a
      PARTIAL unique index `(userId, dedupeKey) WHERE dedupeKey IS NOT NULL`. No stock/batch/
      sale/allocation/existing-notification change; null-key rows stay unconstrained.
- [x] **Pure** `src/lib/expiry.ts`: `classifyExpiry` (non-overlapping buckets expired/today/
      7/30/60/later/missing), `AT_RISK_BUCKETS`, `notificationThresholdFor` (priority expired>
      today>7>30, none >30), `expiryDedupeKey` (date-sensitive), `BUCKET_LABEL`, `THRESHOLD_SEVERITY`.
- [x] **Report query** `src/lib/queries/expiry-reports.ts`: `getExpiryReport(storeId, filter)`
      — summary (per-bucket count/qty/value, total at-risk value, missing-date count) + rows
      (batch/product/variant, qty+unit, expiry key, days, bucket, status, received, effective
      unit cost [batch→variant→product], stock value). Decimal→number at boundary; round2/round3.
      `parseExpiryFilter` for URL filters. Store-scoped; trackExpiry-only; stock>0, non-archived.
- [x] **UI** `/reports/expiry` (Manager-only route rule) — summary cards, window filter tabs,
      table with expiry badges + product edit links, CSV button, `ExpiryRefreshButton`. Feature-
      gated empty state; linked from Reports page when `expiry_batch_enabled`. Not shown to SELLER.
- [x] **CSV** `/api/reports/expiry/export` reuses `getExpiryReport` + `csvEscape` (formula-safe);
      storeId from session (never query param); same filter/timezone as the page.
- [x] **Sweep** `src/lib/expiry-sweep.ts` (server-only): per store — status hygiene
      (ACTIVE→EXPIRED past date, EXPIRED→ACTIVE on corrected date; **never touches stock/
      aggregate/allocations/archive**) + idempotent Manager notifications via `createMany
      skipDuplicates`. Returns structured summary. `refreshExpiryStatusAndNotifications()`
      action (inventory.manage, own store, one activity entry). `POST /api/cron/expiry`
      (Node runtime, `EXPIRY_CRON_SECRET`, Bearer + constant-time compare, 503 if unset / 401 if
      wrong, aggregate counts only). `.env.example` documents the secret + daily call.
- [x] **Notification UI**: `EXPIRING_STOCK`/`EXPIRED_STOCK` icons added to menu + history maps.
- [x] **Tests**: `src/lib/expiry.test.ts` (17 cases) → **154/154**. **Live proof (isolated temp
      stores, cleaned up): 14/14 PASS** — bucket classification, batch/variant/product cost
      fallback + stock value, at-risk total excludes >60, sweep created exactly the expected
      alerts (expired+7+30, not 60/later), expired batch → EXPIRED with **stock unchanged**,
      manager alerted / seller not / cross-store isolated, repeat sweep 0 created + 3 skipped.
- [x] **Validation ALL GREEN**: prisma format/validate/generate · tsc 0 · vitest 154/154 ·
      eslint 0 errors (4 pre-existing warnings) · build --webpack (routes present) · graft build/check.
- Correctness never depends on the sweep: sales/reports classify from expiryDate + store-local
  today directly (proven in 4c1).

## ✅ Phase 5 — deferred Phase 4 backlog closed — SHIPPED
All four items from the Phase 4 deferred list are implemented:
- [x] **Batch archive UI**: `archiveBatch` action (`src/actions/batches.ts`) + Manager confirm
      dialog in `BatchManager`. Sets `status=ARCHIVED` only — never touches stock; terminal state
      (never revived); ARCHIVED rows stay visible (greyed) for history, excluded from FEFO.
- [x] **Disable-tracking workflow**: `disableProductBatchTracking` (archive-batches-keep-
      aggregate per the design doc) — archives every non-ARCHIVED batch for the product, flips
      `trackBatch`/`trackExpiry` to false, blocks on reconciliation mismatch, idempotent. UI:
      `DisableTrackingCard` in `BatchManager` ("danger zone", explicit confirm).
- [x] **Manager return-batch override**: `returnSaleItems` accepts an optional per-line
      `overrideBatchId` (Manager-only, role checked from session — a Seller-submitted override is
      rejected server-side). Accounting still advances the ORIGINAL allocation's
      `returnedQuantity`; physical stock is redirected to the override batch (same store/product/
      variant grain; ARCHIVED targets rejected). Refund/profit math untouched. UI: optional
      "restore to a different batch" selector in the return dialog, Manager-only.
- [x] **Manager expired-sale override**: `createSale` accepts `allowExpiredOverride` — enforced
      from `context.role === "MANAGER"` server-side, never from the client flag alone. When
      needed, draws non-expired stock first, then EXPIRED-by-date batches as the last resort
      (FEFO among them). Every allocation drawn from an expired batch is flagged and logged
      (`sale.expiredOverrideUsed` activity entry with invoice/product/batch). Full rollback
      preserved if even the expanded pool is insufficient. POS: Manager-only confirm dialog
      (`ConfirmDialog` in `pos-terminal.tsx`) offered only when a sale is blocked specifically by
      insufficient non-expired stock; Sellers never see it and a client-sent flag from a Seller
      session is ignored.
- [x] **Verification pass (this session) found and fixed two real defects** in code that existed
      before this check but wasn't yet validated end-to-end:
      1. `onClick={handleCompleteSale}` on the primary POS button forwarded the raw `MouseEvent`
         as the `allowExpiredOverride` parameter (`tsc` caught this: `MouseEvent` isn't assignable
         to `boolean | undefined`). Fixed to `onClick={() => handleCompleteSale()}`.
      2. The Manager expired-stock override had no confirmation UI wired up —
         `setExpiredPromptOpen(true)` was called but nothing rendered based on it, so a blocked
         Manager sale failed *silently* (no toast, no dialog). Added the missing `ConfirmDialog`
         ("Sell expired stock anyway?", destructive, calls `handleCompleteSale(true)` on confirm).
- [x] **Schema/migration** `20260910012133_phase5_allocation_from_expired` (applied): additive
      `SaleItemBatchAllocation.fromExpired Boolean @default(false)` — append-only audit marker for
      expired-override allocations. No stock/batch/sale/existing-allocation change.
- [x] **Pure helper extracted for testability**: `planExpiryAwareAllocation` (`src/lib/batches.ts`)
      — non-expired-first, expired-only-as-last-resort allocation with `fromExpired` tags; used by
      `createSale`. Reconciliation invariant generalized to count ALL non-… (all) batch statuses
      incl. ARCHIVED/EXPIRED (archiving keeps stock), fixed in `assertGrainReconciled`.
- [x] **Validation ALL GREEN**: `tsc --noEmit` 0 errors · `eslint .` 0 errors (4 pre-existing
      warnings) · vitest **161/161** (+7 `planExpiryAwareAllocation` cases) · `next build --webpack`
      (routes incl. `/api/cron/expiry`, `/reports/expiry`) · `graft build`/`check` in sync.
- [x] **Live DB proof (isolated temp store, cleaned up): 19/19 PASS** — archive (status→ARCHIVED,
      stock unchanged, excluded from sellable); disable (all batches archived, flags false,
      aggregate preserved, drift detectable); return override (override batch received units,
      original untouched, original allocation returnedQuantity advanced, reconciled); expired
      override (blocked without / allowed with, fresh-first then 3 from EXPIRED, EXPIRED decremented,
      allocation `fromExpired` persisted, reconciled).
- Seller rejection of both overrides is enforced from `context.role` in the actions (code-level;
  a script can't create authenticated sessions) — the override flags are ignored/rejected for a
  non-Manager regardless of payload.

## Phase 4 — COMPLETE
All of 4a (dormant foundation) → 4b (operational tracking) → 4c1 (expiry-safe activation) → 4c2
(reporting/notifications) → Phase 5 (deferred backlog) are shipped and validated. No open items
remain on the expiry/batch roadmap.

## ✅ CI/CD validation pipeline (GitHub Actions) — SHIPPED
- [x] Added `.github/workflows/ci.yml`: runs on push to `main` and PRs targeting `main`. Steps
      (in order, none with `continue-on-error`): checkout → setup Node 20 (`npm` cache) → `npm ci`
      → `npx prisma validate` → `npx tsc --noEmit` → `npx eslint .` → `npm run test` → `npm run
      build -- --webpack`. Job timeout 20 min. **Validation gate only — no deployment step added.**
- [x] **No Postgres service container.** Investigated instead of assumed:
      - Read all 9 files under `src/lib/**/*.test.ts` (`attributes`, `batches`, `catalog-templates`,
        `csv`, `expiry`, `sale-math`, `storage/r2`, `timezone`, `variant-axes`) — none import
        `@/lib/prisma` or any Prisma-generated type; `r2.test.ts` mocks the S3 client and sets its
        own env vars in `beforeAll`. All are pure-logic tests.
      - Every dashboard route calls `auth()` (reads cookies), so Next marks all of them dynamic
        (`ƒ`) and never executes them at build time — confirmed by inspecting `next build --webpack`
        output (31/31 routes, only `/login`, `/forgot-password`, `/_not-found` are static).
      - Proved empirically, not just by reading code: ran `npm run build -- --webpack` twice — once
        against the real dev `DATABASE_URL`, once with `DATABASE_URL`/`DIRECT_URL` pointed at an
        unreachable `127.0.0.1:59999` — identical successful result both times, and again with the
        real `.env` temporarily swapped for a 3-line placeholder file (`DATABASE_URL`, `DIRECT_URL`,
        `AUTH_SECRET` only). `.env` was restored byte-for-byte afterward (diffed against a backup
        copy before deleting it).
      - `DIRECT_URL` is documented in `.env.example` but not referenced by `prisma.config.ts` or any
        application code — omitted from the CI workflow env for that reason.
- [x] CI env is two inert placeholders only: `DATABASE_URL` (unreachable dummy host) and
      `AUTH_SECRET` (dummy string) — zero real secrets, since this pipeline deploys nowhere.
- [x] `npx prisma generate` is intentionally **not** a separate CI step — `npm ci`'s `postinstall`
      and `npm run build`'s `prebuild` already run it; a third invocation would be a pure duplicate.
- [x] Skipped the optional `graft build`/`graft check` informational step — on a fresh CI checkout
      (no local cache) it would re-parse the whole project on every single run via `npx --yes`,
      adding real time/network variance for a project-map tool with no bearing on correctness.
- [x] Updated `README.md` with a "Continuous Integration" section (checks, order, no-deploy
      statement, and the manual required-status-checks step the maintainer still needs to do in
      GitHub's branch protection settings — not settable from files).
- [x] **Validation (local, real runs, in order)**: `prisma validate` ✅ · `tsc --noEmit` 0 errors ✅ ·
      `eslint .` 0 errors / 4 pre-existing warnings ✅ · `vitest` **161/161** ✅ · `next build
      --webpack` 31 routes ✅ (all four re-verified again under the minimal placeholder-only env).
      Workflow YAML hand-parsed successfully with `js-yaml`; no local GitHub Actions runner exists
      in this sandbox, so an actual GitHub-hosted run was **not** and cannot be claimed as verified
      here — only local step-by-step equivalence and YAML structure were confirmed.
- No application code was changed — no genuine CI-blocking bug was found (all steps already passed
  cleanly against the existing code).

## Phase 3 — P1 hardening (backup durability, correlation IDs)

- [x] **Restore integrity (production-breaking bug).** `restoreBackupPayload` handled only 19 of the
      34 backed-up models. `Size`/`Color`/`VariantAxisDefinition` hold `onDelete: Restrict` FKs to
      `Store`, so `tx.store.deleteMany()` would have **thrown** mid-restore, and 15 tables were
      silently dropped from every restore. Rewrote `src/lib/backup.ts`: schema `BACKUP_VERSION = 2`
      (v1 files still restore — the new tables are optional keys), all 34 models dumped, deleted
      children-before-parents and re-inserted parents-before-children.
- [x] **`users.updatedAt` mutated by restore.** The self-referential `createdById` second pass used
      `tx.user.update`, and `@updatedAt` stamped restore time onto every user that has a creator.
      Switched to a raw `UPDATE "users" SET "createdById" = ...` so restored rows are byte-identical.
      Found only by the live roundtrip below — the source-level guard test cannot see this.
- [x] **Guard test** `src/lib/backup.test.ts` (5 tests, no DB): parses `prisma/schema.prisma` + the
      backup source as text and asserts every model is dumped/deleted/re-inserted and that both
      orders respect the FK graph. Mutation-tested (moved one `deleteMany` to the end → test failed
      with the right message) to prove it is not vacuous. `LoginAttempt` is deliberately excluded.
- [x] **Live roundtrip verification** against a disposable Neon database (`restore_scratch`, created
      + `prisma migrate deploy` + dropped afterward): seeded one row in all 34 tables, dumped,
      restored, re-dumped → `count mismatches: NONE`, `content mismatches: NONE`, `ROUNDTRIP PASS`.
      Harness was throwaway (`scripts/_*.ts`, deleted) and hard-refused to run unless
      `DATABASE_URL` contained `restore_scratch`.
- [x] **Scheduled backups.** `src/lib/backup-run.ts` (`runBackup` shared by the Super Admin action
      and cron; writes a FAILED record on error so a broken nightly job is visible — `pruneBackups`)
      and `POST /api/cron/backup`, bearer-gated on `BACKUP_CRON_SECRET` via `timingSafeEqual`
      (unset → 503, wrong → 401), attributed to the oldest ACTIVE `SUPER_ADMIN`. Pruning runs only
      after a *successful* backup, so a run of failures cannot erode the retention window.
      `deleteBackupFile` added to `src/lib/storage/backups.ts` (local `rm --force` + best-effort R2
      delete, idempotent). R2 bucket lifecycle rule documented as the durable off-site answer.
- [x] **Request correlation IDs.** `src/proxy.ts` set `x-request-id` and its comment claimed
      `logServerError` read it back — it never did. Added `getRequestId()` in `src/lib/logger.ts`
      (dynamic `next/headers` import so vitest/scripts are unaffected) and threaded it through
      `logServerError` / `reportClientError`; all call sites now `await`.
- [x] `.env.example` + `README.md`: `BACKUP_CRON_SECRET`, `BACKUP_RETENTION_DAYS` (default 30),
      R2 lifecycle requirement, and a "Database backups" section (v2 schema, v1 compatibility,
      encryption at rest, cron usage, retention semantics).
- [x] **Correction to the Phase 2 recap:** the "missing" DB indexes already existed —
      `Notification @@index([userId, createdAt])` and `Product @@index([storeId, trackBatch])`.
      No schema change was needed; no migration was written.
- [x] **Validation (local, real runs):** `prisma validate` ✅ · `tsc --noEmit` 0 errors ✅ ·
      `eslint .` 0 errors / 6 warnings (4 pre-existing e2e + 2 new typed-mock params) ✅ ·
      `vitest` **209/209** (was 201) ✅ · `next build --webpack` ✅ with `/api/cron/backup` present ·
      live restore roundtrip **PASS** on scratch Postgres.
- [ ] **Remaining P1:** Sentry / OpenTelemetry error tracking — not started. No `@sentry/*` or
      `@opentelemetry/*` dependency is installed yet; `logServerError` is the intended hook point.
