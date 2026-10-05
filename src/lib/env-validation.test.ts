import { randomBytes } from "crypto";
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  assertEnvOrThrow,
  formatEnvReport,
  validateEnv,
  type EnvLike,
} from "@/lib/env-validation";

/**
 * A fully-valid env fixture. Values here are throwaway test data, never real
 * secrets, and no assertion in this file ever prints one.
 */
function validEnv(): EnvLike {
  return {
    DATABASE_URL: "postgresql://user:pw@db.example.com/app?sslmode=require",
    AUTH_SECRET: randomBytes(32).toString("base64"),
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  };
}

const names = (problems: { variable: string }[]) => problems.map((p) => p.variable);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateEnv — required vars", () => {
  it("passes with only the three required vars set", () => {
    expect(validateEnv(validEnv()).errors).toEqual([]);
  });

  it("detects a missing ENCRYPTION_KEY — the production bug this exists for", () => {
    const env = validEnv();
    delete env.ENCRYPTION_KEY;
    const { errors } = validateEnv(env);
    expect(names(errors)).toContain("ENCRYPTION_KEY");
  });

  it("treats an empty / whitespace ENCRYPTION_KEY as missing", () => {
    for (const value of ["", "   "]) {
      const { errors } = validateEnv({ ...validEnv(), ENCRYPTION_KEY: value });
      expect(names(errors)).toContain("ENCRYPTION_KEY");
    }
  });

  it("detects a malformed-but-PRESENT ENCRYPTION_KEY (wrong byte length)", () => {
    // 31 bytes passes a presence check, then throws at first use — same bug one
    // layer along, which is exactly what shape validation has to catch.
    const env = { ...validEnv(), ENCRYPTION_KEY: randomBytes(31).toString("base64") };
    const { errors } = validateEnv(env);
    const problem = errors.find((e) => e.variable === "ENCRYPTION_KEY");
    expect(problem).toBeDefined();
    expect(problem!.message).toContain("31 bytes");
  });

  it("detects a present-but-not-base64 ENCRYPTION_KEY", () => {
    const { errors } = validateEnv({ ...validEnv(), ENCRYPTION_KEY: "not a key!!!" });
    expect(names(errors)).toContain("ENCRYPTION_KEY");
  });

  it("accepts a 32-byte key regardless of surrounding whitespace", () => {
    const key = randomBytes(32).toString("base64");
    const { errors } = validateEnv({ ...validEnv(), ENCRYPTION_KEY: `  ${key}  ` });
    expect(names(errors)).not.toContain("ENCRYPTION_KEY");
  });

  it("detects a missing AUTH_SECRET, and accepts the NEXTAUTH_SECRET alias", () => {
    const env = validEnv();
    delete env.AUTH_SECRET;
    expect(names(validateEnv(env).errors)).toContain("AUTH_SECRET");
    env.NEXTAUTH_SECRET = randomBytes(32).toString("base64");
    expect(names(validateEnv(env).errors)).not.toContain("AUTH_SECRET");
  });

  it("detects a missing DATABASE_URL and a non-postgres scheme", () => {
    const env = validEnv();
    delete env.DATABASE_URL;
    expect(names(validateEnv(env).errors)).toContain("DATABASE_URL");
    expect(
      names(validateEnv({ ...validEnv(), DATABASE_URL: "mysql://u:p@h/db" }).errors)
    ).toContain("DATABASE_URL");
    // postgres:// is the accepted short alias.
    expect(
      names(validateEnv({ ...validEnv(), DATABASE_URL: "postgres://u:p@h/db" }).errors)
    ).not.toContain("DATABASE_URL");
  });

  it("reports ALL missing required vars at once, not just the first", () => {
    const { errors } = validateEnv({});
    expect(names(errors).sort()).toEqual(["AUTH_SECRET", "DATABASE_URL", "ENCRYPTION_KEY"]);
  });
});

describe("validateEnv — feature-gated vars must NOT hard-fail", () => {
  it("does not error when R2 is entirely absent (local-disk storage)", () => {
    const { errors, warnings } = validateEnv(validEnv());
    expect(errors).toEqual([]);
    expect(names(warnings)).not.toContain("R2_*");
  });

  it("warns but does not error on a PARTIAL R2 config", () => {
    const env = { ...validEnv(), R2_BUCKET: "dashboard" };
    const { errors, warnings } = validateEnv(env);
    expect(errors).toEqual([]);
    expect(names(warnings)).toContain("R2_*");
  });

  it("does not error on a complete R2 config", () => {
    const env = {
      ...validEnv(),
      R2_ACCOUNT_ID: "acct",
      R2_ACCESS_KEY_ID: "akid",
      R2_SECRET_ACCESS_KEY: "sak",
      R2_BUCKET: "dashboard",
      R2_PUBLIC_BASE_URL: "https://pub-abc.r2.dev",
    };
    const { errors, warnings } = validateEnv(env);
    expect(errors).toEqual([]);
    expect(names(warnings)).not.toContain("R2_*");
  });

  it("does not error when Redis rate limiting is absent (in-memory limiter)", () => {
    const { errors } = validateEnv(validEnv());
    expect(errors).toEqual([]);
  });

  it("warns on a half-configured Redis pair without erroring", () => {
    const { errors, warnings } = validateEnv({
      ...validEnv(),
      RATE_LIMIT_REDIS_REST_URL: "https://redis.example.com",
    });
    expect(errors).toEqual([]);
    expect(names(warnings)).toContain("RATE_LIMIT_REDIS_REST_TOKEN");
  });

  it("warns, never errors, on absent cron secrets (routes fail closed with 503)", () => {
    const { errors, warnings } = validateEnv(validEnv());
    expect(errors).toEqual([]);
    expect(names(warnings)).toContain("BACKUP_CRON_SECRET");
    expect(names(warnings)).toContain("EXPIRY_CRON_SECRET");
  });
});

describe("messages never leak a secret value", () => {
  it("omits the rejected ENCRYPTION_KEY value from every message", () => {
    const badKey = randomBytes(31).toString("base64");
    const report = validateEnv({ ...validEnv(), ENCRYPTION_KEY: badKey });
    const text = formatEnvReport(report);
    expect(text).not.toContain(badKey);
    expect(text).toContain("ENCRYPTION_KEY");
  });

  it("omits DATABASE_URL credentials from its message", () => {
    const url = "mysql://leaked_user:leaked_pw@h/db";
    const text = formatEnvReport(validateEnv({ ...validEnv(), DATABASE_URL: url }));
    expect(text).not.toContain("leaked_pw");
    expect(text).not.toContain(url);
  });
});

describe("error message quality", () => {
  it("names the variable, its purpose, and the generation command", () => {
    const env = validEnv();
    delete env.ENCRYPTION_KEY;
    const message = validateEnv(env).errors.find((e) => e.variable === "ENCRYPTION_KEY")!.message;
    expect(message).toContain("ENCRYPTION_KEY is not set");
    expect(message).toContain("AES-256-GCM");
    expect(message).toContain("randomBytes(32).toString('base64')");
  });
});

describe("assertEnvOrThrow", () => {
  it("throws listing every missing required var, and warns separately", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => assertEnvOrThrow({})).toThrow(/ENCRYPTION_KEY/);
    expect(() => assertEnvOrThrow({})).toThrow(/AUTH_SECRET/);
    expect(() => assertEnvOrThrow({})).toThrow(/DATABASE_URL/);
    expect(warn).toHaveBeenCalled();
  });

  it("does not throw on a valid env with no optional features configured", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => assertEnvOrThrow(validEnv())).not.toThrow();
  });

  it("reads process.env by default without mutating it", () => {
    // Snapshot-and-restore so this case cannot poison other tests in the run.
    const original = process.env;
    try {
      process.env = validEnv() as NodeJS.ProcessEnv;
      vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(() => assertEnvOrThrow()).not.toThrow();
      delete process.env.ENCRYPTION_KEY;
      expect(() => assertEnvOrThrow()).toThrow(/ENCRYPTION_KEY/);
    } finally {
      process.env = original;
    }
  });
});
