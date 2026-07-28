import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export const BACKUP_VERSION = 1;

export type BackupPayload = {
  version: number;
  createdAt: string;
  tables: {
    stores: unknown[];
    users: unknown[];
    categories: unknown[];
    suppliers: unknown[];
    products: unknown[];
    productImages: unknown[];
    sales: unknown[];
    saleItems: unknown[];
    inventoryMovements: unknown[];
    expenses: unknown[];
    activityLogs: unknown[];
    notifications: unknown[];
    settings: unknown[];
    userSessions: unknown[];
    passwordResetTokens: unknown[];
    passwordHistory: unknown[];
    twoFactorCredentials: unknown[];
    recoveryCodes: unknown[];
    backupRecords: unknown[];
  };
};

/**
 * Application-level JSON export (Prisma-driven, every table dumped via
 * `findMany`) — `pg_dump` isn't available in this environment, so this is
 * the pragmatic, portable backup format. The file contains sensitive
 * secrets in cleartext exactly like a real `pg_dump` would (TOTP seeds,
 * password/recovery-code hashes) — treat downloaded files accordingly.
 * Login attempts are intentionally excluded: pure rate-limit telemetry,
 * not needed to restore the app to a working state.
 */
export async function createBackupPayload(): Promise<BackupPayload> {
  const [
    stores,
    users,
    categories,
    suppliers,
    products,
    productImages,
    sales,
    saleItems,
    inventoryMovements,
    expenses,
    activityLogs,
    notifications,
    settings,
    userSessions,
    passwordResetTokens,
    passwordHistory,
    twoFactorCredentials,
    recoveryCodes,
    backupRecords,
  ] = await Promise.all([
    prisma.store.findMany(),
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.category.findMany(),
    prisma.supplier.findMany(),
    prisma.product.findMany(),
    prisma.productImage.findMany(),
    prisma.sale.findMany(),
    prisma.saleItem.findMany(),
    prisma.inventoryMovement.findMany(),
    prisma.expense.findMany(),
    prisma.activityLog.findMany(),
    prisma.notification.findMany(),
    prisma.settings.findMany(),
    prisma.userSession.findMany(),
    prisma.passwordResetToken.findMany(),
    prisma.passwordHistory.findMany(),
    prisma.twoFactorCredential.findMany(),
    prisma.recoveryCode.findMany(),
    prisma.backupRecord.findMany(),
  ]);

  return {
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    tables: {
      stores,
      users,
      categories,
      suppliers,
      products,
      productImages,
      sales,
      saleItems,
      inventoryMovements,
      expenses,
      activityLogs,
      notifications,
      settings,
      userSessions,
      passwordResetTokens,
      passwordHistory,
      twoFactorCredentials,
      recoveryCodes,
      backupRecords,
    },
  };
}

export function isValidBackupPayload(value: unknown): value is BackupPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.version === "number" && typeof v.createdAt === "string" && typeof v.tables === "object";
}

/**
 * Wipes every backed-up table and reloads it from `payload`, in a single
 * transaction, in FK-safe order (children deleted before parents, parents
 * inserted before children — Users are inserted without `createdById`
 * first since that FK is self-referential, then patched in a second pass
 * so restore order never matters). Catastrophic if misused — callers must
 * gate this behind Super Admin auth and an explicit typed confirmation.
 */
export async function restoreBackupPayload(payload: BackupPayload): Promise<void> {
  if (payload.version !== BACKUP_VERSION) {
    throw new Error(`Unsupported backup version: ${payload.version}`);
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.recoveryCode.deleteMany();
      await tx.twoFactorCredential.deleteMany();
      await tx.passwordHistory.deleteMany();
      await tx.passwordResetToken.deleteMany();
      await tx.userSession.deleteMany();
      await tx.saleItem.deleteMany();
      await tx.sale.deleteMany();
      await tx.inventoryMovement.deleteMany();
      await tx.productImage.deleteMany();
      await tx.product.deleteMany();
      await tx.notification.deleteMany();
      await tx.activityLog.deleteMany();
      await tx.expense.deleteMany();
      await tx.category.deleteMany();
      await tx.supplier.deleteMany();
      await tx.backupRecord.deleteMany();
      await tx.user.deleteMany();
      await tx.store.deleteMany();
      await tx.settings.deleteMany();

      const t = payload.tables;

      if (t.stores.length) {
        await tx.store.createMany({ data: t.stores as Prisma.StoreCreateManyInput[] });
      }

      if (t.users.length) {
        const users = t.users as Prisma.UserCreateManyInput[];
        await tx.user.createMany({ data: users.map((u) => ({ ...u, createdById: null })) });
        for (const u of users) {
          if (u.createdById) {
            await tx.user.update({ where: { id: u.id as string }, data: { createdById: u.createdById } });
          }
        }
      }

      if (t.categories.length) {
        await tx.category.createMany({ data: t.categories as Prisma.CategoryCreateManyInput[] });
      }
      if (t.suppliers.length) {
        await tx.supplier.createMany({ data: t.suppliers as Prisma.SupplierCreateManyInput[] });
      }
      if (t.products.length) {
        await tx.product.createMany({ data: t.products as Prisma.ProductCreateManyInput[] });
      }
      if (t.productImages.length) {
        await tx.productImage.createMany({ data: t.productImages as Prisma.ProductImageCreateManyInput[] });
      }
      if (t.sales.length) {
        await tx.sale.createMany({ data: t.sales as Prisma.SaleCreateManyInput[] });
      }
      if (t.saleItems.length) {
        await tx.saleItem.createMany({ data: t.saleItems as Prisma.SaleItemCreateManyInput[] });
      }
      if (t.inventoryMovements.length) {
        await tx.inventoryMovement.createMany({ data: t.inventoryMovements as Prisma.InventoryMovementCreateManyInput[] });
      }
      if (t.expenses.length) {
        await tx.expense.createMany({ data: t.expenses as Prisma.ExpenseCreateManyInput[] });
      }
      if (t.activityLogs.length) {
        await tx.activityLog.createMany({ data: t.activityLogs as Prisma.ActivityLogCreateManyInput[] });
      }
      if (t.notifications.length) {
        await tx.notification.createMany({ data: t.notifications as Prisma.NotificationCreateManyInput[] });
      }
      if (t.settings.length) {
        await tx.settings.createMany({ data: t.settings as Prisma.SettingsCreateManyInput[] });
      }
      if (t.userSessions.length) {
        await tx.userSession.createMany({ data: t.userSessions as Prisma.UserSessionCreateManyInput[] });
      }
      if (t.passwordResetTokens.length) {
        await tx.passwordResetToken.createMany({ data: t.passwordResetTokens as Prisma.PasswordResetTokenCreateManyInput[] });
      }
      if (t.passwordHistory.length) {
        await tx.passwordHistory.createMany({ data: t.passwordHistory as Prisma.PasswordHistoryCreateManyInput[] });
      }
      if (t.twoFactorCredentials.length) {
        await tx.twoFactorCredential.createMany({ data: t.twoFactorCredentials as Prisma.TwoFactorCredentialCreateManyInput[] });
      }
      if (t.recoveryCodes.length) {
        await tx.recoveryCode.createMany({ data: t.recoveryCodes as Prisma.RecoveryCodeCreateManyInput[] });
      }
      if (t.backupRecords.length) {
        await tx.backupRecord.createMany({ data: t.backupRecords as Prisma.BackupRecordCreateManyInput[] });
      }
    },
    { timeout: 60_000 }
  );
}
