import { Prisma } from "@/generated/prisma/client";

/**
 * True when a delete failed because other rows still reference it.
 *
 * Two different Postgres error codes reach us here and both mean "something
 * still points at this row":
 *   - 23503 foreign_key_violation, which Prisma maps to its own `P2003`
 *   - 23001 restrict_violation, raised by an `onDelete: Restrict` relation
 *
 * Prisma does NOT map 23001 to P2003, so code that only checked for `P2003`
 * silently missed every RESTRICT-blocked delete and surfaced a raw database
 * error to the user instead of falling back to deactivating/archiving. The
 * raw code is matched from the message because the driver adapter passes it
 * through rather than translating it.
 */
export function isForeignKeyConstraintError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2003") return true;

  const details = `${error.message} ${JSON.stringify(error.meta ?? {})}`;
  return /\b23001\b|\b23503\b|violates RESTRICT|foreign key constraint/i.test(details);
}
