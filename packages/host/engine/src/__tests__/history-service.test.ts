import { MessageIdSchema } from '@linkcode/schema';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { RESOURCE_CONTEXT_SENTINEL } from '../resource/service';
import { HistoryService } from '../session/history-service';
import type { FakeHistoryState } from './fixtures/history-adapter';
import { fakeHistoryFactory, historyId } from './fixtures/history-adapter';

describe('HistoryService', () => {
  it('caches list results until forceRefresh', async () => {
    const state: FakeHistoryState = { listCalls: 0, readCalls: 0, resumeCalls: 0 };
    const service = new HistoryService(fakeHistoryFactory(state), { ttlMs: 60000 });

    await Effect.runPromise(service.list('codex', { cwd: '/repo', limit: 10 }));
    await Effect.runPromise(service.list('codex', { cwd: '/repo', limit: 10 }));
    expect(state.listCalls).toBe(1);

    await Effect.runPromise(service.list('codex', { cwd: '/repo', limit: 10, forceRefresh: true }));
    expect(state.listCalls).toBe(2);
  });

  it('caches converted events and paginates from memory', async () => {
    const state: FakeHistoryState = { listCalls: 0, readCalls: 0, resumeCalls: 0 };
    const service = new HistoryService(fakeHistoryFactory(state), { ttlMs: 60000 });

    await Effect.runPromise(service.list('codex', { cwd: '/lookup-root' }));
    const first = await Effect.runPromise(service.read('codex', { historyId, limit: 1 }));
    const second = await Effect.runPromise(
      service.read('codex', { historyId, cursor: first.cursor, limit: 1 }),
    );

    expect(state.readCalls).toBe(1);
    expect(state.lastReadOptions?.cwd).toBe('/lookup-root');
    expect(first.events).toHaveLength(1);
    expect(first.cursor).toBe('1');
    expect(second.events[0]?.itemId).toBe('a1');

    await Effect.runPromise(service.read('codex', { historyId, limit: 1, forceRefresh: true }));
    expect(state.readCalls).toBe(2);
  });

  it('removes injected resource context from provider history', async () => {
    const state = {
      listCalls: 0,
      readCalls: 0,
      resumeCalls: 0,
      events: [
        {
          historyId,
          itemId: 'u1',
          event: {
            type: 'user-message' as const,
            messageId: MessageIdSchema.parse('u1'),
            content: [
              {
                type: 'text' as const,
                text: `Summarize this\n\n${RESOURCE_CONTEXT_SENTINEL}\n/tmp/resource-1`,
              },
            ],
          },
        },
      ],
    };
    const service = new HistoryService(fakeHistoryFactory(state), { ttlMs: 60000 });

    const result = await Effect.runPromise(service.read('codex', { historyId }));

    expect(result.events[0]?.event).toMatchObject({
      type: 'user-message',
      content: [{ type: 'text', text: 'Summarize this' }],
    });
  });
});
