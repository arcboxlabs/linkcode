import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TtlCache } from '../cache/ttl-cache';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('TtlCache', () => {
  it('dedups concurrent reads into one load', async () => {
    const cache = new TtlCache<number>(1000);
    let loads = 0;
    const load = (): Promise<number> => {
      loads += 1;
      return Promise.resolve(42);
    };
    const [a, b] = await Promise.all([cache.read('k', load), cache.read('k', load)]);
    expect([a, b]).toEqual([42, 42]);
    expect(loads).toBe(1);
  });

  it('serves cached values inside the TTL and reloads after it', async () => {
    const cache = new TtlCache<number>(1000);
    let loads = 0;
    const load = (): Promise<number> => {
      loads += 1;
      return Promise.resolve(loads);
    };
    await expect(cache.read('k', load)).resolves.toBe(1);
    vi.advanceTimersByTime(500);
    await expect(cache.read('k', load)).resolves.toBe(1);
    vi.advanceTimersByTime(600);
    await expect(cache.read('k', load)).resolves.toBe(2);
  });

  it('does not cache failed loads', async () => {
    const cache = new TtlCache<number>(1000);
    let loads = 0;
    await expect(
      cache.read('k', () => {
        loads += 1;
        return Promise.reject(new Error('boom'));
      }),
    ).rejects.toThrow('boom');
    await expect(cache.read('k', () => Promise.resolve(7))).resolves.toBe(7);
    expect(loads).toBe(1);
  });
});
