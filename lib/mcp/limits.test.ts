import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimiter, cachedLoad, clearLoadCache } from './limits';

beforeEach(() => clearLoadCache());

describe('cachedLoad', () => {
  it('loads once and reuses the result within the time limit', async () => {
    let t = 0;
    const loader = vi.fn(async () => ({ n: 1 }));
    await cachedLoad('k', loader, 60_000, () => t);
    t = 59_000;
    await cachedLoad('k', loader, 60_000, () => t);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('loads again after the time limit', async () => {
    let t = 0;
    const loader = vi.fn(async () => 1);
    await cachedLoad('k', loader, 60_000, () => t);
    t = 60_001;
    await cachedLoad('k', loader, 60_000, () => t);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight load between simultaneous calls', async () => {
    let release!: (v: number) => void;
    const loader = vi.fn(() => new Promise<number>((r) => (release = r)));
    const a = cachedLoad('k', loader);
    const b = cachedLoad('k', loader);
    release(7);
    expect(await Promise.all([a, b])).toEqual([7, 7]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failed load', async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error('drive down')).mockResolvedValueOnce('ok');
    await expect(cachedLoad('k', loader)).rejects.toThrow('drive down');
    expect(await cachedLoad('k', loader)).toBe('ok');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('keeps different keys apart', async () => {
    expect(await cachedLoad('a', async () => 'A')).toBe('A');
    expect(await cachedLoad('b', async () => 'B')).toBe('B');
  });
});

describe('RateLimiter', () => {
  it('allows up to the per-minute limit, then refuses with a wait time', () => {
    let t = 1_000_000;
    const limiter = new RateLimiter(3, 100, () => t);
    expect(limiter.take('a').ok).toBe(true);
    t += 10_000;
    expect(limiter.take('a').ok).toBe(true);
    expect(limiter.take('a').ok).toBe(true);
    const refused = limiter.take('a');
    expect(refused).toEqual({ ok: false, window: 'minute', retryAfterSeconds: 50 });
    t += 50_001;
    expect(limiter.take('a').ok).toBe(true);
  });

  it('counts each person separately', () => {
    const limiter = new RateLimiter(1, 100, () => 0);
    expect(limiter.take('a').ok).toBe(true);
    expect(limiter.take('b').ok).toBe(true);
    expect(limiter.take('a').ok).toBe(false);
  });

  it('enforces the hourly limit', () => {
    let t = 0;
    const limiter = new RateLimiter(100, 5, () => t);
    for (let i = 0; i < 5; i++) {
      expect(limiter.take('a').ok).toBe(true);
      t += 120_000;
    }
    const refused = limiter.take('a');
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.window).toBe('hour');
  });

  it('refused calls do not use up the allowance', () => {
    let t = 0;
    const limiter = new RateLimiter(1, 100, () => t);
    limiter.take('a');
    limiter.take('a');
    limiter.take('a');
    t = 60_001;
    expect(limiter.take('a').ok).toBe(true);
  });
});
