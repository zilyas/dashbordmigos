"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireStorePermission } from "@/lib/rbac-guards";
import { mintApiKey } from "@/lib/api/keys";
import { isStorefrontApiEnabled } from "@/lib/features";
import { logActivity } from "@/lib/audit";
import { buildApiClientSchema, type ApiClientInput } from "@/lib/validations/api-client";
import { toAppLocale } from "@/i18n/messages";
import { Prisma } from "@/generated/prisma/client";

// Storefront credentials are the store's own secrets, so the store's Manager mints them.
const requireApiClientManager = requireStorePermission("apiClient.manage");

const MAX_ACTIVE_KEYS = 10;

export async function createApiClient(
  input: ApiClientInput
): Promise<{ error: string } | { success: true; key: string; keyPrefix: string }> {
  const session = await requireApiClientManager();
  const locale = toAppLocale(session.locale);
  const tValidation = await getTranslations({ locale, namespace: "validation" });
  const t = await getTranslations({ locale, namespace: "integrations.actions" });
  const parsed = buildApiClientSchema(tValidation).safeParse(input);
  if (!parsed.success) return { error: t("invalidKeyData") };
  const data = parsed.data;

  // The nav item and the page are both gated on the flag, but a Server Action is
  // a public HTTP endpoint: the owner may have switched the flag off since this
  // page was rendered, and a stale tab must not still be able to mint keys.
  if (!(await isStorefrontApiEnabled(session.storeId))) {
    return { error: t("apiNotEnabled") };
  }

  // Bounds the blast radius of a compromised manager account: an attacker cannot
  // quietly seed dozens of keys to survive the cleanup.
  const active = await prisma.apiClient.count({
    where: { storeId: session.storeId, status: "ACTIVE" },
  });
  if (active >= MAX_ACTIVE_KEYS) {
    return { error: t("maxKeysReached") };
  }

  const minted = mintApiKey();
  const expiresAt = new Date(Date.now() + data.expiresInDays * 86_400_000);

  try {
    const created = await prisma.apiClient.create({
      data: {
        storeId: session.storeId,
        name: data.name,
        keyPrefix: minted.keyPrefix,
        keyHash: minted.keyHash,
        scopes: [...data.scopes],
        actorUserId: session.userId,
        expiresAt,
      },
      select: { id: true },
    });

    // Metadata carries neither the raw key nor the hash: the activity log is read
    // by more eyes than the key list, and is kept long after the key is revoked.
    await logActivity({
      storeId: session.storeId,
      userId: session.userId,
      action: "api_client.create",
      entity: "ApiClient",
      entityId: created.id,
      metadata: { name: data.name, scopes: data.scopes, expiresAt },
    });

    revalidatePath("/integrations");
    return { success: true, key: minted.key, keyPrefix: minted.keyPrefix };
  } catch (error) {
    // Astronomically unlikely on 48 random bits; handled so the manager gets a
    // retry rather than a stack trace.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: t("keyCollision") };
    }
    throw error;
  }
}

export async function revokeApiClient(id: string): Promise<{ error: string } | { success: true }> {
  // Deliberately not gated on isStorefrontApiEnabled: a manager must always be
  // able to kill a leaked key, including after the owner turns the feature off.
  const session = await requireApiClientManager();
  const t = await getTranslations({ locale: toAppLocale(session.locale), namespace: "integrations.actions" });

  // The storeId in the WHERE is what stops one store revoking another's key, and
  // updateMany means an id belonging to another store yields count 0 rather than
  // a distinguishable "forbidden" that would confirm the id exists.
  const { count } = await prisma.apiClient.updateMany({
    where: { id, storeId: session.storeId, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
  if (count === 0) return { error: t("keyNotFound") };

  await logActivity({
    storeId: session.storeId,
    userId: session.userId,
    action: "api_client.revoke",
    entity: "ApiClient",
    entityId: id,
  });

  revalidatePath("/integrations");
  return { success: true };
}
