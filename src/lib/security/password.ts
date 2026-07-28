import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// OWASP-recommended Argon2id parameters for interactive login (~19 MiB, 2 passes, 1 lane).
// Argon2id is the library default, so `algorithm` is left unset — the const
// enum can't be imported under isolatedModules.
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_OPTIONS);
}

/**
 * Verifies a password against either a new Argon2id hash or a legacy bcrypt
 * hash left over from before this module existed, so existing accounts keep
 * working without a forced reset.
 */
export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  if (passwordHash.startsWith("$argon2")) {
    return argon2Verify(passwordHash, password);
  }
  if (passwordHash.startsWith("$2a$") || passwordHash.startsWith("$2b$") || passwordHash.startsWith("$2y$")) {
    return bcrypt.compare(password, passwordHash);
  }
  return false;
}

/** True for legacy bcrypt hashes — callers should re-hash with Argon2id on next successful verify. */
export function needsRehash(passwordHash: string): boolean {
  return !passwordHash.startsWith("$argon2");
}

const PASSWORD_HISTORY_LIMIT = 5;

/** True when `newPassword` matches any of the user's last few passwords. */
export async function checkPasswordHistory(userId: string, newPassword: string): Promise<boolean> {
  const history = await prisma.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: PASSWORD_HISTORY_LIMIT,
    select: { passwordHash: true },
  });
  for (const entry of history) {
    if (await verifyPassword(newPassword, entry.passwordHash)) return true;
  }
  return false;
}

/** Records the hash being replaced and prunes history beyond the retention limit. */
export async function recordPasswordHistory(userId: string, passwordHash: string): Promise<void> {
  await prisma.passwordHistory.create({ data: { userId, passwordHash } });
  const stale = await prisma.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    skip: PASSWORD_HISTORY_LIMIT,
    select: { id: true },
  });
  if (stale.length > 0) {
    await prisma.passwordHistory.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }
}
