// A token bucket per IP, in memory.
//
// In memory is the honest scope: it holds within one server instance and resets on a
// cold start, which is enough to stop a loop hammering the write routes. It is not a
// defence against a distributed flood — the receipt check on every write is what makes
// a forged trade impossible, and that one cannot be bypassed by spreading the load.
type Bucket = { tokens: number; last: number };

const buckets = new Map<string, Bucket>();
const SWEEP_AFTER_MS = 10 * 60_000;
let lastSweep = Date.now();

export type Limit = { capacity: number; refillPerMinute: number };

/** Write routes: 20 at once, then one more every 6 seconds. */
export const WRITE_LIMIT: Limit = { capacity: 20, refillPerMinute: 10 };

export type LimitResult = { ok: true } | { ok: false; retryAfterSec: number };

export function rateLimit(key: string, limit: Limit = WRITE_LIMIT, now = Date.now()): LimitResult {
  if (now - lastSweep > SWEEP_AFTER_MS) {
    for (const [k, b] of buckets) if (now - b.last > SWEEP_AFTER_MS) buckets.delete(k);
    lastSweep = now;
  }

  const refillPerMs = limit.refillPerMinute / 60_000;
  const b = buckets.get(key) ?? { tokens: limit.capacity, last: now };
  b.tokens = Math.min(limit.capacity, b.tokens + (now - b.last) * refillPerMs);
  b.last = now;

  if (b.tokens < 1) {
    buckets.set(key, b);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - b.tokens) / refillPerMs / 1000)) };
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return { ok: true };
}

/**
 * The client's IP. On Vercel `x-forwarded-for` is set by the platform; locally it is
 * absent, so every caller shares one bucket, which is correct for one developer.
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/** Only for tests, so one test's bucket does not leak into the next. */
export function resetRateLimits() {
  buckets.clear();
}
