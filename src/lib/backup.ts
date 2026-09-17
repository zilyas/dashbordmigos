import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * v2 added the 15 tables v1 silently dropped (variants, axes, sizes, colors,
 * category attributes, batches, batch allocations, messaging, announcements).
 * v3 added api_clients (storefront API credentials).
 * v1 and v2 files still restore — their missing tables simply read as empty.
 */
export const BACKUP_VERSION = 3;
const SUPPORTED_VERSIONS = [1, 2, 3];

type Rows = unknown[];

export type BackupPayload = {
  version: number;
  createdAt: string;
  tables: {
    stores: Rows;
    users: Rows;
    categories: Rows;
    suppliers: Rows;
    products: Rows;
    productImages: Rows;
    sales: Rows;
    saleItems: Rows;
    inventoryMovements: Rows;
    expenses: Rows;
    activityLogs: Rows;
    notifications: Rows;
    settings: Rows;
    userSessions: Rows;
    passwordResetTokens: Rows;
    passwordHistory: Rows;
    twoFactorCredentials: Rows;
    recoveryCodes: Rows;
    backupRecords: Rows;
    // v2 additions — optional so a v1 file still parses.
    sizes?: Rows;
    colors?: Rows;
    variantAxisDefinitions?: Rows;
    productVariants?: Rows;
    categoryAttributeDefinitions?: Rows;
    productAttributeValues?: Rows;
    productBatches?: Rows;
    saleItemBatchAllocations?: Rows;
    conversations?: Rows;
    conversationParticipants?: Rows;
    messages?: Rows;
    messageAttachments?: Rows;
    readReceipts?: Rows;
    announcements?: Rows;
    announcementRecipients?: Rows;
    // v3 additions.
    apiClients?: Rows;
  };
};

/**
 * Application-level JSON export (Prisma-driven, every table dumped via
 * `findMany`) — `pg_dump` isn't available in this environment, so this is
 * the pragmatic, portable backup format. The file contains sensitive
 * secrets in cleartext exactly like a real `pg_dump` would (TOTP seeds,
 * password/recovery-code hashes); `writeBackupFile` encrypts it at rest.
 * Login attempts are intentionally excluded: pure rate-limit telemetry,
 * not needed to restore the app to a working state.
 */
export async function createBackupPayload(): Promise<BackupPayload> {
  const [
    stores,
    users,
    categories,
    suppliers,
    sizes,
    colors,
    variantAxisDefinitions,
    products,
    productVariants,
    productImages,
    categoryAttributeDefinitions,
    productAttributeValues,
    productBatches,
    sales,
    saleItems,
    saleItemBatchAllocations,
    inventoryMovements,
    expenses,
    activityLogs,
    notifications,
    conversations,
    conversationParticipants,
    messages,
    messageAttachments,
    readReceipts,
    announcements,
    announcementRecipients,
    settings,
    userSessions,
    passwordResetTokens,
    passwordHistory,
    twoFactorCredentials,
    recoveryCodes,
    backupRecords,
    apiClients,
  ] = await Promise.all([
    prisma.store.findMany(),
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.category.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.supplier.findMany(),
    prisma.size.findMany(),
    prisma.color.findMany(),
    prisma.variantAxisDefinition.findMany(),
    prisma.product.findMany(),
    prisma.productVariant.findMany(),
    prisma.productImage.findMany(),
    prisma.categoryAttributeDefinition.findMany(),
    prisma.productAttributeValue.findMany(),
    prisma.productBatch.findMany(),
    prisma.sale.findMany(),
    prisma.saleItem.findMany(),
    prisma.saleItemBatchAllocation.findMany(),
    prisma.inventoryMovement.findMany(),
    prisma.expense.findMany(),
    prisma.activityLog.findMany(),
    prisma.notification.findMany(),
    prisma.conversation.findMany(),
    prisma.conversationParticipant.findMany(),
    prisma.message.findMany(),
    prisma.messageAttachment.findMany(),
    prisma.readReceipt.findMany(),
    prisma.announcement.findMany(),
    prisma.announcementRecipient.findMany(),
    prisma.settings.findMany(),
    prisma.userSession.findMany(),
    prisma.passwordResetToken.findMany(),
    prisma.passwordHistory.findMany(),
    prisma.twoFactorCredential.findMany(),
    prisma.recoveryCode.findMany(),
    prisma.backupRecord.findMany(),
    prisma.apiClient.findMany(),
  ]);

  return {
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    tables: {
      stores,
      users,
      categories,
      suppliers,
      sizes,
      colors,
      variantAxisDefinitions,
      products,
      productVariants,
      productImages,
      categoryAttributeDefinitions,
      productAttributeValues,
      productBatches,
      sales,
      saleItems,
      saleItemBatchAllocations,
      inventoryMovements,
      expenses,
      activityLogs,
      notifications,
      conversations,
      conversationParticipants,
      messages,
      messageAttachments,
      readReceipts,
      announcements,
      announcementRecipients,
      settings,
      userSessions,
      passwordResetTokens,
      passwordHistory,
      twoFactorCredentials,
      recoveryCodes,
      backupRecords,
      apiClients,
    },
  };
}

export function isValidBackupPayload(value: unknown): value is BackupPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.version === "number" && typeof v.createdAt === "string" && typeof v.tables === "object";
}

/** `undefined` (a v1 file lacking a v2 table) reads as "no rows". */
function rows<T>(value: Rows | undefined): T[] {
  return (value ?? []) as T[];
}

/**
 * Wipes every backed-up table and reloads it from `payload`, in a single
 * transaction, in FK-safe order: children deleted before parents, parents
 * inserted before children. Users are inserted with `createdById` nulled
 * first and patched in a second pass, since that FK is self-referential and
 * insertion order alone cannot guarantee the referent already exists.
 * Catastrophic if misused — callers must gate this behind Super Admin auth
 * and an explicit typed confirmation.
 */
export async function restoreBackupPayload(payload: BackupPayload): Promise<void> {
  if (!SUPPORTED_VERSIONS.includes(payload.version)) {
    throw new Error(`Unsupported backup version: ${payload.version}`);
  }

  await prisma.$transaction(
    async (tx) => {
      // Delete: deepest children first. Every table holding a Restrict FK must
      // be emptied before its parent, or the parent deleteMany throws.
      await tx.saleItemBatchAllocation.deleteMany();
      await tx.readReceipt.deleteMany();
      await tx.messageAttachment.deleteMany();
      await tx.message.deleteMany();
      await tx.conversationParticipant.deleteMany();
      await tx.conversation.deleteMany();
      await tx.announcementRecipient.deleteMany();
      await tx.announcement.deleteMany();
      await tx.recoveryCode.deleteMany();
      await tx.twoFactorCredential.deleteMany();
      await tx.passwordHistory.deleteMany();
      await tx.passwordResetToken.deleteMany();
      await tx.userSession.deleteMany();
      await tx.saleItem.deleteMany();
      await tx.sale.deleteMany();
      await tx.apiClient.deleteMany();
      await tx.inventoryMovement.deleteMany();
      await tx.productBatch.deleteMany();
      await tx.productAttributeValue.deleteMany();
      await tx.categoryAttributeDefinition.deleteMany();
      await tx.productImage.deleteMany();
      await tx.productVariant.deleteMany();
      await tx.product.deleteMany();
      await tx.variantAxisDefinition.deleteMany();
      await tx.size.deleteMany();
      await tx.color.deleteMany();
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

      // Insert: parents first, mirroring the delete order in reverse.
      if (t.stores.length) {
        await tx.store.createMany({ data: t.stores as Prisma.StoreCreateManyInput[] });
      }

      if (t.users.length) {
        const users = t.users as Prisma.UserCreateManyInput[];
        await tx.user.createMany({ data: users.map((u) => ({ ...u, createdById: null })) });
        for (const u of users) {
          if (u.createdById) {
            // Raw UPDATE, not tx.user.update: `updatedAt` is `@updatedAt`, so a
            // client-side update would stamp restore time onto every user that
            // has a creator and silently alter the data being restored.
            await tx.$executeRaw`UPDATE "users" SET "createdById" = ${u.createdById} WHERE "id" = ${u.id as string}`;
          }
        }
      }

      const insert = async <T>(data: T[], fn: (d: T[]) => Promise<unknown>) => {
        if (data.length) await fn(data);
      };

      // Categories self-reference via parentId; one multi-row INSERT resolves
      // intra-batch references because Postgres fires FK triggers per statement.
      await insert(rows<Prisma.CategoryCreateManyInput>(t.categories), (d) =>
        tx.category.createMany({ data: d })
      );
      await insert(rows<Prisma.SupplierCreateManyInput>(t.suppliers), (d) =>
        tx.supplier.createMany({ data: d })
      );
      await insert(rows<Prisma.SizeCreateManyInput>(t.sizes), (d) => tx.size.createMany({ data: d }));
      await insert(rows<Prisma.ColorCreateManyInput>(t.colors), (d) => tx.color.createMany({ data: d }));
      await insert(rows<Prisma.VariantAxisDefinitionCreateManyInput>(t.variantAxisDefinitions), (d) =>
        tx.variantAxisDefinition.createMany({ data: d })
      );
      await insert(rows<Prisma.ProductCreateManyInput>(t.products), (d) =>
        tx.product.createMany({ data: d })
      );
      await insert(rows<Prisma.ProductVariantCreateManyInput>(t.productVariants), (d) =>
        tx.productVariant.createMany({ data: d })
      );
      await insert(rows<Prisma.ProductImageCreateManyInput>(t.productImages), (d) =>
        tx.productImage.createMany({ data: d })
      );
      await insert(
        rows<Prisma.CategoryAttributeDefinitionCreateManyInput>(t.categoryAttributeDefinitions),
        (d) => tx.categoryAttributeDefinition.createMany({ data: d })
      );
      await insert(rows<Prisma.ProductAttributeValueCreateManyInput>(t.productAttributeValues), (d) =>
        tx.productAttributeValue.createMany({ data: d })
      );
      await insert(rows<Prisma.ProductBatchCreateManyInput>(t.productBatches), (d) =>
        tx.productBatch.createMany({ data: d })
      );
      // Before sales: Sale.apiClientId points here. After users: actorUserId does.
      await insert(rows<Prisma.ApiClientCreateManyInput>(t.apiClients), (d) =>
        tx.apiClient.createMany({ data: d })
      );
      await insert(rows<Prisma.SaleCreateManyInput>(t.sales), (d) => tx.sale.createMany({ data: d }));
      await insert(rows<Prisma.SaleItemCreateManyInput>(t.saleItems), (d) =>
        tx.saleItem.createMany({ data: d })
      );
      await insert(
        rows<Prisma.SaleItemBatchAllocationCreateManyInput>(t.saleItemBatchAllocations),
        (d) => tx.saleItemBatchAllocation.createMany({ data: d })
      );
      await insert(rows<Prisma.InventoryMovementCreateManyInput>(t.inventoryMovements), (d) =>
        tx.inventoryMovement.createMany({ data: d })
      );
      await insert(rows<Prisma.ExpenseCreateManyInput>(t.expenses), (d) =>
        tx.expense.createMany({ data: d })
      );
      await insert(rows<Prisma.ActivityLogCreateManyInput>(t.activityLogs), (d) =>
        tx.activityLog.createMany({ data: d })
      );
      await insert(rows<Prisma.NotificationCreateManyInput>(t.notifications), (d) =>
        tx.notification.createMany({ data: d })
      );
      await insert(rows<Prisma.ConversationCreateManyInput>(t.conversations), (d) =>
        tx.conversation.createMany({ data: d })
      );
      await insert(
        rows<Prisma.ConversationParticipantCreateManyInput>(t.conversationParticipants),
        (d) => tx.conversationParticipant.createMany({ data: d })
      );
      await insert(rows<Prisma.MessageCreateManyInput>(t.messages), (d) =>
        tx.message.createMany({ data: d })
      );
      await insert(rows<Prisma.MessageAttachmentCreateManyInput>(t.messageAttachments), (d) =>
        tx.messageAttachment.createMany({ data: d })
      );
      await insert(rows<Prisma.ReadReceiptCreateManyInput>(t.readReceipts), (d) =>
        tx.readReceipt.createMany({ data: d })
      );
      await insert(rows<Prisma.AnnouncementCreateManyInput>(t.announcements), (d) =>
        tx.announcement.createMany({ data: d })
      );
      await insert(rows<Prisma.AnnouncementRecipientCreateManyInput>(t.announcementRecipients), (d) =>
        tx.announcementRecipient.createMany({ data: d })
      );
      await insert(rows<Prisma.SettingsCreateManyInput>(t.settings), (d) =>
        tx.settings.createMany({ data: d })
      );
      await insert(rows<Prisma.UserSessionCreateManyInput>(t.userSessions), (d) =>
        tx.userSession.createMany({ data: d })
      );
      await insert(rows<Prisma.PasswordResetTokenCreateManyInput>(t.passwordResetTokens), (d) =>
        tx.passwordResetToken.createMany({ data: d })
      );
      await insert(rows<Prisma.PasswordHistoryCreateManyInput>(t.passwordHistory), (d) =>
        tx.passwordHistory.createMany({ data: d })
      );
      await insert(rows<Prisma.TwoFactorCredentialCreateManyInput>(t.twoFactorCredentials), (d) =>
        tx.twoFactorCredential.createMany({ data: d })
      );
      await insert(rows<Prisma.RecoveryCodeCreateManyInput>(t.recoveryCodes), (d) =>
        tx.recoveryCode.createMany({ data: d })
      );
      await insert(rows<Prisma.BackupRecordCreateManyInput>(t.backupRecords), (d) =>
        tx.backupRecord.createMany({ data: d })
      );
    },
    { timeout: 60_000 }
  );
}
