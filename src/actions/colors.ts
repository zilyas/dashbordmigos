"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireStorePermission } from "@/lib/rbac-guards";
import { colorSchema, type ColorInput } from "@/lib/validations/color";
import { Prisma } from "@/generated/prisma/client";

const requireColorManager = requireStorePermission("category.manage");

export async function createColor(input: ColorInput) {
  const session = await requireColorManager();
  const parsed = colorSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid color data" };

  try {
    await prisma.color.create({
      data: {
        storeId: session.storeId,
        name: parsed.data.name,
        hex: parsed.data.hex || null,
        position: parsed.data.position ?? 0,
      },
    });
    revalidatePath("/colors");
    revalidatePath("/products");
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A color with that name already exists." };
    }
    throw error;
  }
}

export async function updateColor(id: string, input: ColorInput) {
  const session = await requireColorManager();
  const parsed = colorSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid color data" };

  const existing = await prisma.color.findFirst({ where: { id, storeId: session.storeId } });
  if (!existing) return { error: "Color not found" };

  try {
    await prisma.color.update({
      where: { id },
      data: {
        name: parsed.data.name,
        hex: parsed.data.hex || null,
        position: parsed.data.position ?? existing.position,
      },
    });
    revalidatePath("/colors");
    revalidatePath("/products");
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A color with that name already exists." };
    }
    throw error;
  }
}

export async function deleteColor(id: string) {
  const session = await requireColorManager();
  const existing = await prisma.color.findFirst({ where: { id, storeId: session.storeId } });
  if (!existing) return { error: "Color not found" };

  try {
    await prisma.color.delete({ where: { id } });
    revalidatePath("/colors");
    revalidatePath("/products");
    return { success: true as const };
  } catch {
    return { error: "Failed to delete color." };
  }
}
