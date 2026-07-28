import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { HistoryService } from '../session/history-service';
import { fakeHistoryFactory, historyId } from './fixtures/history-adapter';

describe('HistoryService', () => {
  it('caches list results until forceRefresh', async () => {
    const state = { listCalls: 0, readCalls: 0, resumeCalls: 0 };
    const service = new HistoryService(fakeHistoryFactory(state), { ttlMs: 60000 });

    await Effect.runPromise(service.list('codex', { cwd: '/repo', limit: 10 }));
    await Effect.runPromise(service.list('codex', { cwd: '/repo', limit: 10 }));
    expect(state.listCalls).toBe(1);

    await Effect.runPromise(service.list('codex', { cwd: '/repo', limit: 10, forceRefresh: true }));
    expect(state.listCalls).toBe(2);
  });

  it('caches converted events and paginates from memory', async () => {
    const state = { listCalls: 0, readCalls: 0, resumeCalls: 0 };
    const service = new HistoryService(fakeHistoryFactory(state), { ttlMs: 60000 });

    const first = await Effect.runPromise(service.read('codex', { historyId, limit: 1 }));
    const second = await Effect.runPromise(
      service.read('codex', { historyId, cursor: first.cursor, limit: 1 }),
    );

    expect(state.readCalls).toBe(1);
    expect(first.events).toHaveLength(1);
    expect(first.cursor).toBe('1');
    expect(second.events[0]?.itemId).toBe('a1');

    await Effect.runPromise(service.read('codex', { historyId, limit: 1, forceRefresh: true }));
    expect(state.readCalls).toBe(2);
  });
});
