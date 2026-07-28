import { prisma } from "@/lib/prisma";
import { getRequestInfo, type RequestInfo } from "@/lib/security/request-info";
import type { Prisma } from "@/generated/prisma/client";

type AuditClient = typeof prisma | Prisma.TransactionClient;

export type LogActivityParams = {
  storeId: string | null;
  userId: string;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  /** Pass this when the caller already extracted request info (e.g. auth.ts's authorize()) to avoid re-deriving it. */
  requestInfo?: Pick<RequestInfo, "ipAddress" | "userAgent">;
};

/**
 * Single write path for the ActivityLog audit trail — every mutating action
 * should call this instead of `prisma.activityLog.create` directly, so IP
 * and User-Agent are always captured consistently. Pass a transaction
 * client as the second argument to log inside an existing `$transaction`.
 */
export async function logActivity(params: LogActivityParams, client: AuditClient = prisma): Promise<void> {
  const info = params.requestInfo ?? (await getRequestInfo());
  await client.activityLog.create({
    data: {
      storeId: params.storeId,
      userId: params.userId,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId ?? null,
      metadata: params.metadata as Prisma.InputJsonValue | undefined,
      ipAddress: info.ipAddress,
      userAgent: info.userAgent,
    },
  });
}
