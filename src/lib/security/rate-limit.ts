// In-memory sliding-window rate limiter. Single-instance only — state is
// lost on restart/redeploy and isn't shared across serverless instances.
// That's an accepted tradeoff at this deployment's scale; the production
// upgrade path is a shared store (Upstash/Redis) behind the same interface.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitConfig = { limit: number; windowMs: number };

export type RateLimitResult = {
  success: boolean;
  remaining: number;
  resetAt: number;
};

export function rateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + config.windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { success: true, remaining: config.limit - 1, resetAt };
  }

  if (existing.count >= config.limit) {
    return { success: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { success: true, remaining: config.limit - existing.count, resetAt: existing.resetAt };
}

/** Clears a key's bucket — e.g. reset the login limiter after a successful sign-in. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

export const RATE_LIMITS = {
  login: { limit: 5, windowMs: 15 * 60 * 1000 },
  passwordReset: { limit: 3, windowMs: 60 * 60 * 1000 },
  upload: { limit: 20, windowMs: 60 * 1000 },
} as const satisfies Record<string, RateLimitConfig>;
