import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  // PrismaPg forwards this object straight to `new pg.Pool(config)` (see
  // node_modules/@prisma/adapter-pg/dist/index.js), so it takes the same
  // options as node-postgres's Pool/Client config — confirmed against
  // https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/connection-pool
  // and https://node-postgres.com/apis/client. Without a `max`, the pool is
  // unbounded and can exhaust the Neon pooler's connection allowance under
  // load; without `statement_timeout`, one runaway query holds a connection
  // open forever.
  //
  // 60s statement_timeout matches the existing 60_000ms interactive-transaction
  // budget this app already trusts for its heaviest DB work (the full-table
  // restore transaction in src/lib/backup.ts) — generous enough for CSV
  // exports and backup/restore routines, short enough to free a stuck
  // connection well before a request would time out anyway.
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX) || 10,
    statement_timeout: 60_000,
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
