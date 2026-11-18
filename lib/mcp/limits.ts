/**
 * Guards that keep the Claude connector from straining Google Drive, which the
 * dashboard depends on too (same service account, same API quota).
 *
 * - `cachedLoad` keeps each loaded file for a short time and shares one
 *   in-flight load between simultaneous calls, so a burst of tool calls reads
 *   Drive once instead of once per call.
 * - `RateLimiter` caps how many tool calls one person can make per minute and
 *   per hour.
 *
 * Both live in memory on a server instance. Vercel may run several instances,
 * so the limits are per instance: approximate, but enough to stop a runaway
 * loop from one chat.
 */

type Entry<T> = { expires: number; value: Promise<T> };

const cache = new Map<string, Entry<unknown>>();

export const LOAD_TTL_MS = 60_000;

export function cachedLoad<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs: number = LOAD_TTL_MS,
  now: () => number = Date.now,
): Promise<T> {
  const hit = cache.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > now()) return hit.value;
  const value = loader();
  cache.set(key, { expires: now() + ttlMs, value });
  // Never keep a failed load: the next call tries Drive again.
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

export function clearLoadCache() {
  cache.clear();
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number; window: 'minute' | 'hour' };

export class RateLimiter {
  private calls = new Map<string, number[]>();

  constructor(
    private readonly perMinute: number,
    private readonly perHour: number,
    private readonly now: () => number = Date.now,
  ) {}

  reset() {
    this.calls.clear();
  }

  /** Record a call for `key` if it is within the limits. */
  take(key: string): RateLimitResult {
    const t = this.now();
    const recent = (this.calls.get(key) ?? []).filter((c) => c > t - 3_600_000);
    const lastMinute = recent.filter((c) => c > t - 60_000);
    if (lastMinute.length >= this.perMinute) {
      this.calls.set(key, recent);
      return { ok: false, window: 'minute', retryAfterSeconds: Math.ceil((lastMinute[0] + 60_000 - t) / 1000) };
    }
    if (recent.length >= this.perHour) {
      this.calls.set(key, recent);
      return { ok: false, window: 'hour', retryAfterSeconds: Math.ceil((recent[0] + 3_600_000 - t) / 1000) };
    }
    recent.push(t);
    this.calls.set(key, recent);
    return { ok: true };
  }
}

/** Generous for normal use: one question usually takes 1–5 tool calls. */
export const TOOL_CALLS_PER_MINUTE = 30;
export const TOOL_CALLS_PER_HOUR = 300;

export const connectorRateLimiter = new RateLimiter(TOOL_CALLS_PER_MINUTE, TOOL_CALLS_PER_HOUR);
