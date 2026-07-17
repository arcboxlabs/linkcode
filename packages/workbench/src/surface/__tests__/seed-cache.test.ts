import type { AgentEvent, AgentHistoryId, AgentKind } from '@linkcode/schema';
import { WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import type { SeedCacheStorage } from '../seed-cache';
import { loadPersistedSeed, persistSeed } from '../seed-cache';

const kind: AgentKind = 'claude-code';
const historyId = (value: string): AgentHistoryId => value as AgentHistoryId;

function userText(text: string): AgentEvent {
  return { type: 'user-message', content: [{ type: 'text', text }] };
}

function seedEvent(text: string, ts?: number): { event: AgentEvent; ts?: number } {
  return { event: userText(text), ts };
}

function fakeStorage(failSetItemTimes = 0): SeedCacheStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  let failures = failSetItemTimes;
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem(key, value) {
      if (key.startsWith('linkcode.seed.') && failures > 0) {
        failures -= 1;
        throw new Error('QuotaExceededError');
      }
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

describe('seed cache', () => {
  it('round-trips a seed (with event timestamps) and loads it back with uptoSeq 0', () => {
    const storage = fakeStorage();
    persistSeed(
      kind,
      historyId('h1'),
      { events: [seedEvent('hi', 1_700_000_000_000)], uptoSeq: 42 },
      storage,
    );
    expect(loadPersistedSeed(kind, historyId('h1'), storage)).toEqual({
      events: [seedEvent('hi', 1_700_000_000_000)],
      uptoSeq: 0,
    });
  });

  it('misses on an absent key and on a stale wire version', () => {
    const storage = fakeStorage();
    expect(loadPersistedSeed(kind, historyId('absent'), storage)).toBeUndefined();

    storage.map.set(
      `linkcode.seed.${kind}.stale`,
      JSON.stringify({ v: WIRE_PROTOCOL_VERSION - 1, events: [userText('old')] }),
    );
    expect(loadPersistedSeed(kind, historyId('stale'), storage)).toBeUndefined();
    // Loading runs during render, so the stale entry stays put (purity); the memoized miss
    // prevents re-parsing, and a later persist simply overwrites it.
    expect(storage.map.has(`linkcode.seed.${kind}.stale`)).toBe(true);
    persistSeed(kind, historyId('stale'), { events: [seedEvent('fresh')], uptoSeq: 0 }, storage);
    expect(loadPersistedSeed(kind, historyId('stale'), storage)).toEqual({
      events: [seedEvent('fresh')],
      uptoSeq: 0,
    });
  });

  it('misses on unparseable JSON without throwing', () => {
    const storage = fakeStorage();
    storage.map.set(`linkcode.seed.${kind}.broken`, '{not json');
    expect(loadPersistedSeed(kind, historyId('broken'), storage)).toBeUndefined();
  });

  it('caps the number of persisted entries, evicting the least recently written', () => {
    const storage = fakeStorage();
    for (let index = 0; index < 25; index += 1) {
      persistSeed(
        kind,
        historyId(`h${index}`),
        { events: [seedEvent(`m${index}`)], uptoSeq: 0 },
        storage,
      );
    }
    expect(storage.map.has(`linkcode.seed.${kind}.h0`)).toBe(false);
    expect(storage.map.has(`linkcode.seed.${kind}.h24`)).toBe(true);
    const persisted = [...storage.map.keys()].filter((key) => key.startsWith('linkcode.seed.c'));
    expect(persisted.length).toBeLessThanOrEqual(20);
  });

  it('sheds old entries under quota pressure and still persists the new seed', () => {
    const storage = fakeStorage();
    persistSeed(kind, historyId('old1'), { events: [seedEvent('a')], uptoSeq: 0 }, storage);
    persistSeed(kind, historyId('old2'), { events: [seedEvent('b')], uptoSeq: 0 }, storage);

    const failing = { ...storage, ...fakeStorage(0) };
    // Reuse the same backing map but fail the first two writes of the new entry.
    let failures = 2;
    failing.map = storage.map;
    failing.getItem = (key) => storage.map.get(key) ?? null;
    failing.removeItem = (key) => {
      storage.map.delete(key);
    };
    failing.setItem = (key, value) => {
      if (key.startsWith('linkcode.seed.') && failures > 0) {
        failures -= 1;
        throw new Error('QuotaExceededError');
      }
      storage.map.set(key, value);
    };

    persistSeed(kind, historyId('new'), { events: [seedEvent('c')], uptoSeq: 0 }, failing);
    expect(storage.map.has(`linkcode.seed.${kind}.old1`)).toBe(false);
    expect(storage.map.has(`linkcode.seed.${kind}.old2`)).toBe(false);
    expect(loadPersistedSeed(kind, historyId('new'), failing)).toEqual({
      events: [seedEvent('c')],
      uptoSeq: 0,
    });
  });
});
