// Rate limiter with a swappable backend behind one async interface.
//
// Default: in-memory fixed-window, single-instance only — state is lost on
// restart/redeploy and isn't shared across replicas or serverless instances.
// That's an accepted tradeoff at this deployment's current (single-instance)
// scale.
//
// Multi-replica upgrade path: set RATE_LIMIT_REDIS_REST_URL (+ _TOKEN) and the
// limiter switches to a shared Upstash Redis backend — no call-site changes,
// because the public API is already async. Leave the vars unset and behaviour
// is byte-for-byte identical to before. See README "Rate limiting" and
// .env.example for setup.

import { scopedLogger } from "@/lib/logger";

const rateLogger = scopedLogger("system");

export type RateLimitConfig = { limit: number; windowMs: number };

export type RateLimitResult = {
  success: boolean;
  remaining: number;
  resetAt: number;
};

/**
 * The contract every backend implements. `limit` records one hit against `key`
 * within `config.windowMs` and reports whether the caller is still under
 * `config.limit`; `reset` clears a key (e.g. after a successful sign-in). Both
 * are async so a network-backed store (Redis) is a drop-in for the in-memory
 * one with no changes at the call sites in `auth.ts` / `password-reset.ts`.
 */
export interface RateLimiterBackend {
  limit(key: string, config: RateLimitConfig): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

// ── In-memory backend (default) ─────────────────────────────────────────────

type Bucket = { count: number; resetAt: number };

class InMemoryRateLimiter implements RateLimiterBackend {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();
  private static readonly SWEEP_INTERVAL_MS = 5 * 60 * 1000;

  private sweep(now: number) {
    if (now - this.lastSweep < InMemoryRateLimiter.SWEEP_INTERVAL_MS) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  async limit(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const now = Date.now();
    this.sweep(now);

    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      const resetAt = now + config.windowMs;
      this.buckets.set(key, { count: 1, resetAt });
      return { success: true, remaining: config.limit - 1, resetAt };
    }

    if (existing.count >= config.limit) {
      return { success: false, remaining: 0, resetAt: existing.resetAt };
    }

    existing.count += 1;
    return { success: true, remaining: config.limit - existing.count, resetAt: existing.resetAt };
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }
}

// ── Upstash Redis (REST) backend (opt-in) ───────────────────────────────────

// Atomic fixed-window matching the in-memory semantics: INCR the counter, set
// the expiry only on the first hit of the window, and read the remaining TTL to
// compute resetAt — all in one round trip so concurrent replicas can't race.
const WINDOW_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('PTTL', KEYS[1])}
`;

class UpstashRateLimiter implements RateLimiterBackend {
  constructor(
    private readonly restUrl: string,
    private readonly token: string,
  ) {}

  private async command<T>(body: unknown[]): Promise<T> {
    const res = await fetch(this.restUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Upstash REST ${res.status}: ${await res.text().catch(() => "")}`);
    }
    const json = (await res.json()) as { result?: T; error?: string };
    if (json.error) throw new Error(`Upstash: ${json.error}`);
    return json.result as T;
  }

  async limit(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const now = Date.now();
    try {
      const [count, pttl] = await this.command<[number, number]>([
        "EVAL",
        WINDOW_SCRIPT,
        "1",
        key,
        String(config.windowMs),
      ]);
      const resetAt = pttl >= 0 ? now + pttl : now + config.windowMs;
      if (count > config.limit) {
        return { success: false, remaining: 0, resetAt };
      }
      return { success: true, remaining: Math.max(0, config.limit - count), resetAt };
    } catch (err) {
      // Fail open: a Redis outage must not lock every user out of login /
      // password reset. We log loudly so the outage is visible; brute-force
      // protection also still has the DB-backed account lockout as a backstop.
      rateLogger.error({ err, key }, "rate limiter Redis error — failing open");
      return { success: true, remaining: config.limit - 1, resetAt: now + config.windowMs };
    }
  }

  async reset(key: string): Promise<void> {
    try {
      await this.command(["DEL", key]);
    } catch (err) {
      rateLogger.error({ err, key }, "rate limiter Redis reset error");
    }
  }
}

// ── Backend selection ───────────────────────────────────────────────────────

function createBackend(): RateLimiterBackend {
  const url = process.env.RATE_LIMIT_REDIS_REST_URL?.trim();
  const token = process.env.RATE_LIMIT_REDIS_REST_TOKEN?.trim();
  if (url && token) {
    rateLogger.info("rate limiter using shared Upstash Redis backend");
    return new UpstashRateLimiter(url, token);
  }
  return new InMemoryRateLimiter();
}

const backend: RateLimiterBackend = createBackend();

export function rateLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
  return backend.limit(key, config);
}

/** Clears a key's bucket — e.g. reset the login limiter after a successful sign-in. */
export function resetRateLimit(key: string): Promise<void> {
  return backend.reset(key);
}

export const RATE_LIMITS = {
  login: { limit: 5, windowMs: 15 * 60 * 1000 },
  passwordReset: { limit: 3, windowMs: 60 * 60 * 1000 },
  upload: { limit: 20, windowMs: 60 * 1000 },
} as const satisfies Record<string, RateLimitConfig>;
