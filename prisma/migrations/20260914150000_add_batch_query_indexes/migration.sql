-- Add indexes for optimized batch reconciliation queries.
-- Product[storeId, trackBatch]: filters tracked products per store in getStoreBatchReconciliation.
-- Notification[userId, createdAt]: supports user notification sorting and filtering by timestamp.

CREATE INDEX "products_store_track_batch_idx" ON "products"("storeId", "trackBatch");

CREATE INDEX "notifications_user_created_at_idx" ON "notifications"("userId", "createdAt");
