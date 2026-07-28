import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Role } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/security/password";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const DEV_PASSWORD = "Password123!";

async function main() {
  console.log("Seeding database...");

  const passwordHash = await hashPassword(DEV_PASSWORD);

  const superAdmin = await prisma.user.upsert({
    where: { email: "superadmin@store.dev" },
    update: {},
    create: {
      name: "Platform Owner",
      email: "superadmin@store.dev",
      passwordHash,
      role: Role.SUPER_ADMIN,
      status: "ACTIVE",
    },
  });

  console.log(`Super Admin ready: ${superAdmin.email} / ${DEV_PASSWORD}`);
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
