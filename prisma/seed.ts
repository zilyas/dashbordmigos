import "dotenv/config";
import { randomBytes } from "crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Role } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/security/password";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Same default email every environment has always used — changing it would
// make re-seeding an existing database silently create a second Super
// Admin instead of recognizing the one that's already there. Override via
// env var for a genuinely fresh deployment.
const SUPER_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? "superadmin@store.dev";
const SUPER_ADMIN_NAME = process.env.SEED_SUPER_ADMIN_NAME ?? "Platform Owner";

/** Guaranteed to satisfy the app's own password policy (length, upper, lower, digit, symbol). */
function generateSecurePassword(): string {
  const random = randomBytes(12).toString("base64").replace(/[+/=]/g, "").slice(0, 16);
  return `${random}!A1`;
}

async function main() {
  console.log("Seeding database...");

  const existing = await prisma.user.findUnique({ where: { email: SUPER_ADMIN_EMAIL } });
  if (existing) {
    console.log(`Super Admin already exists: ${existing.email} (password left unchanged).`);
    return;
  }

  const suppliedPassword = process.env.SEED_SUPER_ADMIN_PASSWORD;
  const password = suppliedPassword ?? generateSecurePassword();
  const passwordHash = await hashPassword(password);

  const superAdmin = await prisma.user.create({
    data: {
      name: SUPER_ADMIN_NAME,
      email: SUPER_ADMIN_EMAIL,
      passwordHash,
      role: Role.SUPER_ADMIN,
      status: "ACTIVE",
    },
  });

  if (suppliedPassword) {
    console.log(`Super Admin created: ${superAdmin.email} (password set from SEED_SUPER_ADMIN_PASSWORD).`);
  } else {
    console.log("=".repeat(64));
    console.log(`Super Admin created: ${superAdmin.email}`);
    console.log(`One-time generated password: ${password}`);
    console.log("Save this now — it will not be shown again. Change it after first login.");
    console.log("=".repeat(64));
  }
  console.log("Database is otherwise clean — create Stores and Managers from inside the app.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
