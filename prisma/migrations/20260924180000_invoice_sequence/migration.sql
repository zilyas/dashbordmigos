-- CreateTable
CREATE TABLE "invoice_sequences" (
    "storeId" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("storeId")
);

-- AddForeignKey
ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: seed each store that already has sales with the highest invoice
-- sequence number it has ever used, extracted from the "INV-NNNNNN" text.
-- This is not optional decoration — without it, the application code's
-- upsert(create: { nextValue: 1 }) would treat every existing store as brand
-- new on its first post-deploy sale, collide with that store's real
-- INV-000001, and (since the collision rolls back the whole transaction,
-- including this same upsert) retry into the identical collision every time
-- until the invoice_contention retry budget is exhausted. A store with no
-- prior sales gets no row here on purpose — its first sale still legitimately
-- starts the sequence at 1 via the application's upsert.
-- The `~ '^INV-[0-9]+$'` filter is stricter than a LIKE on purpose: a single
-- historical row with a hand-edited or imported invoice number would make the
-- CAST raise and abort the whole migration mid-deploy. Rows that do not match
-- are ignored, which at worst re-issues a number that the unique constraint
-- then rejects and the retry loop works around.
INSERT INTO "invoice_sequences" ("storeId", "nextValue")
SELECT "storeId", MAX(CAST(SUBSTRING("invoiceNumber" FROM 5) AS INTEGER))
FROM "sales"
WHERE "invoiceNumber" ~ '^INV-[0-9]+$'
GROUP BY "storeId";
