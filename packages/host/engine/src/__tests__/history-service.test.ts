import { HistoryCheckpointInvalidError } from '@linkcode/agent-adapter';
import type { AgentHistoryBranchOptions, AgentHistoryCapabilities } from '@linkcode/schema';
import { MessageIdSchema } from '@linkcode/schema';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { RESOURCE_CONTEXT_SENTINEL } from '../resource/service';
import { HistoryService } from '../session/history-service';
import type { FakeHistoryState } from './fixtures/history-adapter';
import { FakeHistoryAdapter, fakeHistoryFactory, historyId } from './fixtures/history-adapter';

class ForkingHistoryAdapter extends FakeHistoryAdapter {
  override readonly historyCapabilities: AgentHistoryCapabilities;
  readonly branched: AgentHistoryBranchOptions[] = [];
  failWith: Error | undefined;

  constructor(
    state: FakeHistoryState,
    capabilities: Pick<AgentHistoryCapabilities, 'forkAfterTurn' | 'branch'>,
  ) {
    super('codex', state);
    this.historyCapabilities = { list: true, read: true, resume: true, ...capabilities };
  }

  override branchHistory(opts: AgentHistoryBranchOptions): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.branched.push(opts);
    return Promise.resolve();
  }
}

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

  describe('branch', () => {
    const start = { kind: 'codex' as const, cwd: '/repo' };
    const opts = { historyId, cursor: 'opaque-cursor' };

    it('is gated on forkAfterTurn, not on the legacy branch mirror', async () => {
      const state: FakeHistoryState = { listCalls: 0, readCalls: 0, resumeCalls: 0 };
      const service = new HistoryService(fakeHistoryFactory(state));
      const mirrorOnly = new ForkingHistoryAdapter(state, { branch: true });

      const failure = await Effect.runPromise(
        service.branch(mirrorOnly, opts, start).pipe(Effect.flip),
      );
      expect(failure).toMatchObject({ _tag: 'RequestError', code: 'unsupported' });
      expect(mirrorOnly.branched).toEqual([]);

      const forking = new ForkingHistoryAdapter(state, { forkAfterTurn: true });
      await Effect.runPromise(service.branch(forking, opts, start));
      expect(forking.branched).toEqual([opts]);
    });

    it('maps an invalid checkpoint to a typed unsupported and keeps other failures opaque', async () => {
      const state: FakeHistoryState = { listCalls: 0, readCalls: 0, resumeCalls: 0 };
      const service = new HistoryService(fakeHistoryFactory(state));

      const invalid = new ForkingHistoryAdapter(state, { forkAfterTurn: true });
      invalid.failWith = new HistoryCheckpointInvalidError('codex: thread/fork refused turn-9');
      const refused = await Effect.runPromise(
        service.branch(invalid, opts, start).pipe(Effect.flip),
      );
      expect(refused).toMatchObject({
        _tag: 'RequestError',
        code: 'unsupported',
        message: 'codex: thread/fork refused turn-9',
      });

      const broken = new ForkingHistoryAdapter(state, { forkAfterTurn: true });
      broken.failWith = new Error('secret provider transcript path');
      const failure = await Effect.runPromise(
        service.branch(broken, opts, start).pipe(Effect.flip),
      );
      expect(failure).toMatchObject({
        _tag: 'OperationError',
        publicMessage: 'Failed to branch agent history',
      });
    });
  });
});
