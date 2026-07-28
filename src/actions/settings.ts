"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { getSessionContext, requireStoreId } from "@/lib/store-context";
import { logActivity } from "@/lib/audit";
import { storeSettingsSchema, type StoreSettingsInput } from "@/lib/validations/settings";

export async function updateStoreSettings(input: StoreSettingsInput) {
  const context = await getSessionContext();
  if (!context || !can(context.role, "settings.manage")) {
    return { error: "Not authorized" };
  }
  const storeId = requireStoreId(context);

  const parsed = storeSettingsSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid settings data" };
  const data = parsed.data;

  await prisma.store.update({
    where: { id: storeId },
    data: {
      name: data.storeName,
      currency: data.currency.toUpperCase(),
      taxRate: data.taxRate,
      allowSellerViewCost: data.allowSellerViewCost,
      address: data.address || null,
      city: data.city || null,
      country: data.country || null,
      phone: data.phone || null,
      email: data.email || null,
      logo: data.logo || null,
    },
  });

  await logActivity({
    storeId,
    userId: context.userId,
    action: "settings.updated",
    entity: "Store",
    entityId: storeId,
    metadata: { storeName: data.storeName },
  });

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { success: true as const };
}
