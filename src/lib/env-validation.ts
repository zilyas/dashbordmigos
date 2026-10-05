/**
 * Fail-fast environment validation, run once at server startup from
 * `src/instrumentation.ts`.
 *
 * Why this exists: ENCRYPTION_KEY was absent in production for weeks. Nothing
 * failed at deploy time — it only surfaced when a user tried to enrol in 2FA
 * or a backup cron fired, as a mystery error deep inside a request. A missing
 * required secret must stop the app at boot instead.
 *
 * Design rules this file follows:
 *  - NEVER include a secret's VALUE in a message. Names, and decoded *lengths*,
 *    only. A 31-byte key echoed into a log is a leaked key.
 *  - Report EVERY problem at once. An operator fixing one var, redeploying and
 *    hitting the next is a bad loop.
 *  - Only hard-fail on what is genuinely always needed. R2 (local-disk
 *    fallback), Redis (in-memory rate limiter) and the cron secrets are
 *    feature-gated — hard-failing on those would break deployments that work
 *    today, which is a worse bug than the one this fixes.
 *  - Plain predicates, not Zod. The three shape rules here are one-liners and
 *    the hand-written messages are the deliverable: each names the variable,
 *    says what it is for, and gives the exact command to generate it. Zod's
 *    issue formatting cannot do that, and it can echo the received input.
 *
 * Defence in depth: `getEncryptionKey()` still validates at point of use. This
 * check is additive, never a replacement.
 */

/** A single failed check. `variable` is a name; nothing here ever holds a value. */
export type EnvProblem = { variable: string; message: string };

export type EnvReport = { errors: EnvProblem[]; warnings: EnvProblem[] };

/**
 * Narrower than `NodeJS.ProcessEnv` on purpose: Next's type declares NODE_ENV
 * as always-present, which would force every test fixture to carry it. All this
 * module needs is name -> optional string.
 */
export type EnvLike = Record<string, string | undefined>;

const GEN_32_BYTE_BASE64 =
  'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"';

function present(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** True only if `raw` is canonical base64 that decodes to exactly `bytes` bytes. */
function decodesToBytes(raw: string, bytes: number): boolean {
  // Buffer.from(_, "base64") is lenient — it skips invalid characters rather
  // than throwing — so re-encoding is the only reliable way to reject junk.
  const trimmed = raw.trim();
  const buf = Buffer.from(trimmed, "base64");
  return buf.length === bytes && buf.toString("base64") === trimmed;
}

/**
 * Pure: inspects an env-like object and returns every problem found.
 * Takes `env` as a parameter rather than reading `process.env` directly so
 * tests can pass a fixture without mutating global state.
 */
export function validateEnv(env: EnvLike = process.env): EnvReport {
  const errors: EnvProblem[] = [];
  const warnings: EnvProblem[] = [];

  // ── REQUIRED ──────────────────────────────────────────────────────────────
  // DATABASE_URL — every request that touches Prisma. src/lib/prisma.ts hands
  // it straight to PrismaPg, so a non-postgres scheme fails at first query.
  const databaseUrl = env.DATABASE_URL;
  if (!present(databaseUrl)) {
    errors.push({
      variable: "DATABASE_URL",
      message:
        "DATABASE_URL is not set. It is the pooled PostgreSQL connection string every database query uses. " +
        "Format: postgresql://USER:PASSWORD@HOST/DB?sslmode=require",
    });
  } else {
    let scheme: string | null = null;
    try {
      scheme = new URL(databaseUrl.trim()).protocol;
    } catch {
      scheme = null;
    }
    if (scheme !== "postgres:" && scheme !== "postgresql:") {
      errors.push({
        variable: "DATABASE_URL",
        message:
          "DATABASE_URL is not a PostgreSQL connection URL — it must start with postgresql:// (or postgres://). " +
          "Format: postgresql://USER:PASSWORD@HOST/DB?sslmode=require",
      });
    }
  }

  // AUTH_SECRET — read by next-auth itself (node_modules/next-auth/lib/env.js),
  // not through process.env anywhere in src/, which is why a usage grep misses
  // it. Without it @auth/core throws MissingSecret on the first auth request:
  // nobody can sign in. Presence only — @auth/core accepts any non-empty
  // string and derives its key, so asserting 32-byte base64 here would reject
  // secrets that work today.
  if (!present(env.AUTH_SECRET) && !present(env.NEXTAUTH_SECRET)) {
    errors.push({
      variable: "AUTH_SECRET",
      message:
        "AUTH_SECRET is not set. NextAuth v5 uses it to sign and encrypt session cookies; without it every " +
        `sign-in fails. Generate one with: ${GEN_32_BYTE_BASE64}`,
    });
  }

  // ENCRYPTION_KEY — AES-256-GCM key for TOTP secrets at rest and backup
  // files. 14 read sites; getEncryptionKey() (src/lib/security/encryption.ts)
  // throws without it, which breaks 2FA enrolment, 2FA sign-in and all backups.
  const encryptionKey = env.ENCRYPTION_KEY;
  if (!present(encryptionKey)) {
    errors.push({
      variable: "ENCRYPTION_KEY",
      message:
        "ENCRYPTION_KEY is not set. It is the AES-256-GCM key that encrypts 2FA (TOTP) secrets at rest and " +
        "backup files; without it 2FA enrolment, 2FA sign-in and every backup fail. " +
        `Generate one with: ${GEN_32_BYTE_BASE64}`,
    });
  } else if (!decodesToBytes(encryptionKey, 32)) {
    // Decoded LENGTH only, never the value — a wrong-length key is still a secret.
    const decodedBytes = Buffer.from(encryptionKey.trim(), "base64").length;
    errors.push({
      variable: "ENCRYPTION_KEY",
      message:
        `ENCRYPTION_KEY is set but is not valid base64 for exactly 32 bytes (it decoded to ${decodedBytes} bytes). ` +
        "AES-256 needs a 32-byte key, so this would throw at first use instead of at boot. " +
        `Regenerate with: ${GEN_32_BYTE_BASE64}`,
    });
  }

  // ── FEATURE-GATED (warn, never fail) ─────────────────────────────────────
  // R2 is all-or-nothing: isR2Configured() (src/lib/storage/r2.ts) requires all
  // five, and getUploadAdapter() silently falls back to local disk otherwise. A
  // PARTIAL config means the operator meant R2 and quietly got local disk —
  // worth saying out loud, but NOT worth failing: .env.example ships
  // R2_BUCKET and R2_PUBLIC_BASE_URL pre-filled, so partial is the default
  // state of a copied example file, and local-disk uploads genuinely work.
  const r2Vars = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_PUBLIC_BASE_URL",
  ] as const;
  const r2Set = r2Vars.filter((name) => present(env[name]));
  if (r2Set.length > 0 && r2Set.length < r2Vars.length) {
    const missing = r2Vars.filter((name) => !present(env[name]));
    warnings.push({
      variable: "R2_*",
      message:
        `Cloudflare R2 is only partially configured (missing: ${missing.join(", ")}), so uploads are silently ` +
        "using the local-disk adapter. Set all five, or clear them all to make local storage explicit.",
    });
  }
  if (present(env.R2_PUBLIC_BASE_URL)) {
    try {
      new URL(env.R2_PUBLIC_BASE_URL.trim());
    } catch {
      warnings.push({
        variable: "R2_PUBLIC_BASE_URL",
        message:
          "R2_PUBLIC_BASE_URL is not a valid absolute URL, so next.config.ts drops the R2 origin from the CSP " +
          "img-src and from next/image remotePatterns, and product images will not load. Expected the bucket's " +
          "r2.dev Public Development URL or a connected custom domain, with no trailing slash.",
      });
    }
  }

  // Redis rate limiting is a documented multi-replica upgrade path; this
  // project runs the in-memory limiter today. The pair must be set together.
  const redisUrl = present(env.RATE_LIMIT_REDIS_REST_URL);
  const redisToken = present(env.RATE_LIMIT_REDIS_REST_TOKEN);
  if (redisUrl !== redisToken) {
    warnings.push({
      variable: redisUrl ? "RATE_LIMIT_REDIS_REST_TOKEN" : "RATE_LIMIT_REDIS_REST_URL",
      message:
        "Only one of RATE_LIMIT_REDIS_REST_URL / RATE_LIMIT_REDIS_REST_TOKEN is set, so the login rate limiter " +
        "is still the in-memory one and is not shared across replicas. Set both to switch, or clear both.",
    });
  }

  // The cron secrets fail CLOSED (both routes return 503 when unset), which is
  // correct — but it means the schedule silently never runs and nobody is
  // alerted. Warn so "no backups are happening" is visible at boot.
  if (!present(env.BACKUP_CRON_SECRET)) {
    warnings.push({
      variable: "BACKUP_CRON_SECRET",
      message:
        "BACKUP_CRON_SECRET is not set, so POST /api/cron/backup returns 503 and NO scheduled database backups " +
        `are running. Set it, and point your scheduler at the route. Generate with: ${GEN_32_BYTE_BASE64}`,
    });
  }
  if (!present(env.EXPIRY_CRON_SECRET)) {
    warnings.push({
      variable: "EXPIRY_CRON_SECRET",
      message:
        "EXPIRY_CRON_SECRET is not set, so POST /api/cron/expiry returns 503 and the daily expiry status + " +
        "notification sweep never runs. Sale eligibility is unaffected. " +
        `Generate with: ${GEN_32_BYTE_BASE64}`,
    });
  }

  return { errors, warnings };
}

/** Renders a report into the exact text printed or thrown at boot. Values never appear. */
export function formatEnvReport(report: EnvReport): string {
  const lines: string[] = [];
  if (report.errors.length > 0) {
    lines.push(
      `Startup aborted: ${report.errors.length} required environment variable(s) missing or malformed.`,
      ""
    );
    for (const problem of report.errors) lines.push(`  x ${problem.message}`);
    lines.push("", "See .env.example for the full list. Fix all of the above, then redeploy.");
  }
  if (report.warnings.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Optional / feature-gated configuration notices (not fatal):");
    for (const problem of report.warnings) lines.push(`  ! ${problem.message}`);
  }
  return lines.join("\n");
}

/**
 * Boot gate. Logs the non-fatal notices, then throws on any required-var
 * failure so the server never starts serving traffic in a broken state.
 */
export function assertEnvOrThrow(env: EnvLike = process.env): void {
  const report = validateEnv(env);
  if (report.warnings.length > 0) {
    console.warn(formatEnvReport({ errors: [], warnings: report.warnings }));
  }
  if (report.errors.length > 0) {
    throw new Error(formatEnvReport({ errors: report.errors, warnings: [] }));
  }
}
