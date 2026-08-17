import { MessageIdSchema, textBlock } from '@linkcode/schema';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { RESOURCE_CONTEXT_SENTINEL } from '../resource/service';
import { HistoryService } from '../session/history-service';
import { promptContentFingerprint } from '../session/live-session';
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

  it('hands the injected MCP server names to cold reads', async () => {
    const state: FakeHistoryState = { listCalls: 0, readCalls: 0, resumeCalls: 0 };
    const service = new HistoryService(fakeHistoryFactory(state), {
      ttlMs: 60000,
      injectedMcpServerNames: (kind) => (kind === 'opencode' ? ['linkcode-sim'] : []),
    });

    await Effect.runPromise(service.read('opencode', { historyId }));
    expect(state.lastReadOptions?.mcpServerNames).toEqual(['linkcode-sim']);

    await Effect.runPromise(service.read('codex', { historyId }));
    expect(state.lastReadOptions?.mcpServerNames).toBeUndefined();
  });

  it('evicts expired cache entries instead of keeping dead transcripts', async () => {
    const state: FakeHistoryState = { listCalls: 0, readCalls: 0, resumeCalls: 0 };
    let now = 0;
    const service = new HistoryService(fakeHistoryFactory(state), { ttlMs: 1000, now: () => now });

    await Effect.runPromise(service.list('codex', { cwd: '/repo' }));
    await Effect.runPromise(service.read('codex', { historyId }));
    expect(service.cacheSizes()).toEqual({ list: 1, events: 1 });

    now = 1000;
    await Effect.runPromise(service.list('codex', { cwd: '/other' }));
    expect(service.cacheSizes()).toEqual({ list: 1, events: 0 });
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

  it('resolves live prompt offsets against fresh provider history', async () => {
    const events = ['first-cursor', 'second-cursor'].map((branchCursor, index) => ({
      historyId,
      itemId: `u${index + 1}`,
      event: {
        type: 'user-message' as const,
        messageId: MessageIdSchema.parse(`u${index + 1}`),
        content: [{ type: 'text' as const, text: `prompt ${index + 1}` }],
        branchCursor,
      },
    }));
    const state: FakeHistoryState = {
      listCalls: 0,
      readCalls: 0,
      resumeCalls: 0,
      events,
    };
    const service = new HistoryService(fakeHistoryFactory(state));

    await expect(
      Effect.runPromise(
        service.resolveLiveBranchCursor(
          'codex',
          historyId,
          '/repo',
          0,
          promptContentFingerprint([textBlock('prompt 2')]),
        ),
      ),
    ).resolves.toBe('second-cursor');
    await expect(
      Effect.runPromise(
        service.resolveLiveBranchCursor(
          'codex',
          historyId,
          '/repo',
          0,
          promptContentFingerprint([textBlock('prompt 1')]),
        ),
      ),
    ).resolves.toBe('first-cursor');
    await expect(
      Effect.runPromise(
        service.resolveLiveBranchCursor(
          'codex',
          historyId,
          '/repo',
          0,
          promptContentFingerprint([
            textBlock('prompt 2'),
            { type: 'image', mimeType: 'image/png', data: 'AA==' },
          ]),
        ),
      ),
    ).resolves.toBe('second-cursor');
    await expect(
      Effect.runPromise(
        service.resolveLiveBranchCursor(
          'codex',
          historyId,
          '/repo',
          0,
          promptContentFingerprint([textBlock('different prompt')]),
        ),
      ),
    ).rejects.toThrow('The prompt does not match the latest provider history');
  });
});
