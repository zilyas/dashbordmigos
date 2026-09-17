/**
 * Operator CLI for public-API credentials. There is deliberately no web UI yet:
 * minting a key that can decrement real inventory is a rare, high-consequence
 * action, and a shell command leaves the secret in one place (this terminal)
 * rather than in a browser, a screenshot, and a server log.
 *
 *   npx tsx scripts/api-key.ts list   <storeCode>
 *   npx tsx scripts/api-key.ts mint   <storeCode> <name> [--days 365] [--scopes a,b]
 *   npx tsx scripts/api-key.ts revoke <keyPrefix>
 *
 * The key is printed exactly once and never stored — only its SHA-256 hash is.
 * If it is lost, revoke it and mint another.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { mintApiKey } from "../src/lib/api/keys";
import { API_SCOPES } from "../src/lib/api/auth";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function resolveStore(code: string) {
  const store = await prisma.store.findUnique({ where: { code }, select: { id: true, name: true } });
  if (!store) throw new Error(`No store with code "${code}".`);
  return store;
}

async function list(storeCode: string) {
  const store = await resolveStore(storeCode);
  const clients = await prisma.apiClient.findMany({
    where: { storeId: store.id },
    orderBy: { createdAt: "desc" },
    select: { name: true, keyPrefix: true, scopes: true, status: true, expiresAt: true, lastUsedAt: true },
  });
  if (clients.length === 0) {
    console.log(`No API clients for ${store.name}.`);
    return;
  }
  console.log(`API clients for ${store.name}:\n`);
  for (const c of clients) {
    const expired = c.expiresAt && c.expiresAt.getTime() <= Date.now();
    console.log(
      `  ${c.keyPrefix}  ${c.status}${expired ? " (EXPIRED)" : ""}  ${c.name}\n` +
        `    scopes:  ${c.scopes.join(", ")}\n` +
        `    expires: ${c.expiresAt?.toISOString() ?? "never"}\n` +
        `    lastUse: ${c.lastUsedAt?.toISOString() ?? "never"}\n`
    );
  }
}

async function mint(storeCode: string, name: string) {
  const store = await resolveStore(storeCode);

  const scopesRaw = flag("scopes");
  const scopes = scopesRaw ? scopesRaw.split(",").map((s) => s.trim()) : [...API_SCOPES];
  const unknown = scopes.filter((s) => !API_SCOPES.includes(s as (typeof API_SCOPES)[number]));
  if (unknown.length > 0) throw new Error(`Unknown scope(s): ${unknown.join(", ")}. Valid: ${API_SCOPES.join(", ")}`);

  const days = Number(flag("days") ?? 365);
  if (!Number.isFinite(days) || days <= 0) throw new Error("--days must be a positive number.");
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  // Every API-created Sale, InventoryMovement and ActivityLog needs a real user
  // (those FKs are non-nullable). Bind the key to this store's oldest active
  // Manager — the same "pick a system actor" shape /api/cron/backup uses.
  const actor = await prisma.user.findFirst({
    where: { storeId: store.id, role: "MANAGER", status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  });
  if (!actor) throw new Error(`Store "${storeCode}" has no ACTIVE MANAGER to attribute API orders to.`);

  const { key, keyPrefix, keyHash } = mintApiKey();
  await prisma.apiClient.create({
    data: { storeId: store.id, name, keyPrefix, keyHash, scopes, actorUserId: actor.id, expiresAt },
  });

  console.log(`\nAPI key for ${store.name} — "${name}"`);
  console.log(`  scopes:  ${scopes.join(", ")}`);
  console.log(`  actor:   ${actor.email}`);
  console.log(`  expires: ${expiresAt.toISOString()}`);
  console.log(`\n  ${key}\n`);
  console.log("This is the only time the key is shown. Store it in the storefront's secret manager now.\n");
}

async function revoke(keyPrefix: string) {
  const res = await prisma.apiClient.updateMany({
    where: { keyPrefix, revokedAt: null },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
  console.log(res.count > 0 ? `Revoked ${keyPrefix}. It stops working on the next request.` : `No active key with prefix ${keyPrefix}.`);
}

async function main() {
  const [command, a, b] = process.argv.slice(2);
  try {
    if (command === "list" && a) await list(a);
    else if (command === "mint" && a && b) await mint(a, b);
    else if (command === "revoke" && a) await revoke(a);
    else {
      console.log(
        "Usage:\n" +
          "  npx tsx scripts/api-key.ts list   <storeCode>\n" +
          "  npx tsx scripts/api-key.ts mint   <storeCode> <name> [--days 365] [--scopes products:read,orders:create]\n" +
          "  npx tsx scripts/api-key.ts revoke <keyPrefix>"
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`\nError: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
