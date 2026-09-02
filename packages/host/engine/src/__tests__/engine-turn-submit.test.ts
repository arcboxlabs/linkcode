import { setImmediate as nextLoopTurn } from 'node:timers/promises';
import { asHistoryId, HistoryCheckpointInvalidError } from '@linkcode/agent-adapter';
import type {
  AgentHistoryBranchOptions,
  AgentHistoryCapabilities,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistoryResumeOptions,
  AgentInput,
  MessageId,
  StartOptions,
  TurnId,
  WirePayload,
} from '@linkcode/schema';
import {
  AttachmentIdSchema,
  OperationIdSchema,
  RunIdSchema,
  SessionIdSchema,
  TurnIdSchema,
} from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryConversationStore } from '../conversation/conversation-store';
import { InMemorySessionStore } from '../session/session-store';
import {
  FakeAdapter,
  createSessionHarness as harness,
  settleEngineTasks,
  startedSessionId as startedId,
} from './fixtures/session-harness';

class RejectingTurnAdapter extends FakeAdapter {
  override send(input: AgentInput): Promise<void> {
    this.sentInputs.push(input);
    return Promise.reject(new Error('provider rejected input'));
  }
}

class RejectOnceAdapter extends FakeAdapter {
  private rejected = false;

  override send(input: AgentInput): Promise<void> {
    if (!this.rejected) {
      this.rejected = true;
      return Promise.reject(new Error('provider rejected input'));
    }
    return super.send(input);
  }
}

class HangingResumeAdapter extends FakeAdapter {
  override resumeHistory(): Promise<void> {
    return new Promise<void>(noop);
  }
}

class GatedResumeAdapter extends FakeAdapter {
  releaseResume: () => void = noop;

  override resumeHistory(opts: AgentHistoryResumeOptions): Promise<void> {
    this.resumedFrom = opts.historyId;
    return new Promise((resolve) => {
      this.releaseResume = resolve;
    });
  }
}

/** send() spans the whole turn (pi-style): the adapter emits `running` and resolves only later. */
class WholeTurnSendAdapter extends FakeAdapter {
  override send(input: AgentInput): Promise<void> {
    this.sentInputs.push(input);
    this.emit({ type: 'status', status: 'running' });
    return new Promise<void>(noop);
  }
}

class SilentHangingSendAdapter extends FakeAdapter {
  override send(input: AgentInput): Promise<void> {
    this.sentInputs.push(input);
    return new Promise<void>(noop);
  }
}

class ForkingAdapter extends FakeAdapter {
  override readonly historyCapabilities: AgentHistoryCapabilities = {
    list: false,
    read: true,
    resume: true,
    forkAfterTurn: true,
    branch: true,
  };
  branchedFrom: AgentHistoryBranchOptions | null = null;
  failFork: Error | undefined;

  branchHistory(opts: AgentHistoryBranchOptions, startOpts: StartOptions): Promise<void> {
    if (this.failFork) return Promise.reject(this.failFork);
    this.branchedFrom = opts;
    this.startedWith = startOpts;
    this.emit({ type: 'session-ref', historyId: asHistoryId('native-child') });
    return Promise.resolve();
  }
}

/** Cold reads return the lineage's own prompts; a row without a cursor models a rollout the
 * provider cannot fork (codex `history_mode: paginated`). */
class AlignedHistoryAdapter extends ForkingAdapter {
  constructor(private readonly rows: Array<{ text: string; cursor?: string }>) {
    super();
  }

  override readHistory(opts: AgentHistoryReadOptions): Promise<AgentHistoryReadResult> {
    return Promise.resolve({
      session: { historyId: opts.historyId, kind: this.kind, cwd: '/repo' },
      events: this.rows.map((row, index) => ({
        historyId: opts.historyId,
        itemId: `u${index}`,
        event: {
          type: 'user-message' as const,
          messageId: `u${index}` as MessageId,
          content: [{ type: 'text' as const, text: row.text }],
          ...(row.cursor !== undefined && { branchCursor: row.cursor }),
        },
      })),
    });
  }
}

function forkedAdapter(adapters: FakeAdapter[]): ForkingAdapter {
  return nullthrow(
    adapters.find(
      (adapter): adapter is ForkingAdapter =>
        adapter instanceof ForkingAdapter && adapter.branchedFrom !== null,
    ),
  );
}

/** First start is a normal adapter; the first relaunch is `make()`; later ones are normal. */
function secondAdapter(make: () => FakeAdapter): () => FakeAdapter {
  let index = 0;
  return () => {
    index += 1;
    return index === 2 ? make() : new FakeAdapter();
  };
}

function submittedTurnId(sent: WirePayload[], replyTo: string): TurnId {
  const reply = sent.find(
    (payload) => payload.kind === 'turn.submitted' && payload.replyTo === replyTo,
  );
  if (reply?.kind !== 'turn.submitted') throw new Error(`no turn.submitted for ${replyTo}`);
  return reply.turnId;
}

function failure(sent: WirePayload[], replyTo: string) {
  const reply = sent.find(
    (payload) => payload.kind === 'request.failed' && payload.replyTo === replyTo,
  );
  if (reply?.kind !== 'request.failed') throw new Error(`no request.failed for ${replyTo}`);
  return reply;
}

async function startedHarness(makeAdapter: () => FakeAdapter = () => new FakeAdapter()) {
  const conversationStore = new InMemoryConversationStore();
  const h = harness(
    new InMemorySessionStore(),
    makeAdapter,
    undefined,
    undefined,
    undefined,
    undefined,
    { conversationStore },
  );
  await h.engine.start();
  await h.inject({
    kind: 'session.start',
    clientReqId: 'r1',
    opts: { kind: 'claude-code', cwd: '/repo' },
  });
  const sessionId = startedId(h.sent, 'r1');
  return { ...h, conversationStore, sessionId, adapter: nullthrow(h.adapters[0]) };
}

function submitPrompt(
  h: Awaited<ReturnType<typeof startedHarness>>,
  clientReqId: string,
  text: string,
  extra: Partial<{ parentTurnId: TurnId | null; expectedGraphRevision: number }> = {},
) {
  return h.inject({
    kind: 'turn.submit',
    clientReqId,
    sessionId: h.sessionId,
    operationId: OperationIdSchema.parse(`op-${clientReqId}`),
    input: { type: 'prompt', blocks: [{ type: 'text', text }] },
    ...extra,
  });
}

/** Two settled turns on `native-1`, each with a live `ending` checkpoint. */
async function twoCheckpointedTurns(h: Awaited<ReturnType<typeof startedHarness>>) {
  await submitPrompt(h, 's1', 'first');
  const firstTurnId = submittedTurnId(h.sent, 's1');
  h.adapter.emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
  h.adapter.emitCheckpoint({ historyId: asHistoryId('native-1'), cursor: 'cp-1', turn: 'ending' });
  h.adapter.emit({ type: 'status', status: 'idle' });
  await settleEngineTasks();
  await submitPrompt(h, 's2', 'second');
  h.adapter.emitCheckpoint({ historyId: asHistoryId('native-1'), cursor: 'cp-2', turn: 'ending' });
  h.adapter.emit({ type: 'status', status: 'idle' });
  await settleEngineTasks();
  return firstTurnId;
}

describe('turn.submit saga', () => {
  it('submits a plain send onto a live session and commits the turn', async () => {
    const h = await startedHarness();

    await submitPrompt(h, 's1', 'hello');

    const turnId = submittedTurnId(h.sent, 's1');
    const [turn] = await h.conversationStore.listTurns(h.sessionId);
    expect(turn).toMatchObject({
      turnId,
      parentTurnId: null,
      siblingOrdinal: 1,
      state: 'running',
    });
    expect(h.adapter.sentInputs).toEqual([
      { type: 'prompt', content: [{ type: 'text', text: 'hello' }] },
    ]);
    expect(h.sent).toContainEqual(
      expect.objectContaining({
        kind: 'conversation.graph.changed',
        sessionId: h.sessionId,
        graphRevision: 1,
        activeLeafTurnId: turnId,
      }),
    );
    expect(
      h.sent.some(
        (payload) => payload.kind === 'agent.event' && payload.event.type === 'user-message',
      ),
    ).toBe(true);
  });

  it('replays a lost reply verbatim instead of duplicating a sibling', async () => {
    const h = await startedHarness();
    await submitPrompt(h, 's1', 'hello');
    const firstTurnId = submittedTurnId(h.sent, 's1');
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();

    await h.inject({
      kind: 'turn.submit',
      clientReqId: 's1-retry',
      sessionId: h.sessionId,
      operationId: OperationIdSchema.parse('op-s1'),
      input: { type: 'prompt', blocks: [{ type: 'text', text: 'hello' }] },
    });

    expect(submittedTurnId(h.sent, 's1-retry')).toBe(firstTurnId);
    expect(await h.conversationStore.listTurns(h.sessionId)).toHaveLength(1);
    expect(h.adapter.sentInputs).toHaveLength(1);
  });

  it('refuses a submit while a turn is running', async () => {
    const h = await startedHarness();
    await submitPrompt(h, 's1', 'hello');
    h.adapter.emit({ type: 'status', status: 'running' });

    await submitPrompt(h, 's2', 'racing');

    expect(failure(h.sent, 's2').code).toBe('busy');
    expect(await h.conversationStore.listTurns(h.sessionId)).toHaveLength(1);
  });

  it('refuses a submit while another operation is open', async () => {
    const h = await startedHarness();
    await h.conversationStore.persistTurnIntent({
      turn: {
        turnId: TurnIdSchema.parse('turn-open'),
        sessionId: h.sessionId,
        parentTurnId: null,
        input: { type: 'shell-command', command: 'sleep 1' },
        runId: RunIdSchema.parse('run-elsewhere'),
        state: 'preparing',
        createdAt: Date.now(),
      },
      operation: {
        operationId: OperationIdSchema.parse('op-open'),
        sessionId: h.sessionId,
        kind: 'turn.submit',
        state: 'open',
        createdAt: Date.now(),
      },
    });

    await submitPrompt(h, 's1', 'hello');

    expect(failure(h.sent, 's1').code).toBe('busy');
  });

  it('tip-continues the active leaf with the revision guard, and conflicts when stale', async () => {
    const h = await startedHarness();
    await submitPrompt(h, 's1', 'first');
    const firstTurnId = submittedTurnId(h.sent, 's1');
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();

    await submitPrompt(h, 's2', 'stale', { parentTurnId: firstTurnId, expectedGraphRevision: 0 });
    expect(failure(h.sent, 's2').code).toBe('conflict');

    await submitPrompt(h, 's3', 'continue', {
      parentTurnId: firstTurnId,
      expectedGraphRevision: 1,
    });
    const secondTurnId = submittedTurnId(h.sent, 's3');
    const turns = await h.conversationStore.listTurns(h.sessionId);
    expect(turns.find((turn) => turn.turnId === secondTurnId)).toMatchObject({
      parentTurnId: firstTurnId,
      siblingOrdinal: 1,
      state: 'running',
    });
  });

  it('plain sends carry no revision guard even after the graph moved', async () => {
    const h = await startedHarness();
    await submitPrompt(h, 's1', 'first');
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();

    await submitPrompt(h, 's2', 'second');

    const secondTurnId = submittedTurnId(h.sent, 's2');
    const turns = await h.conversationStore.listTurns(h.sessionId);
    expect(turns.find((turn) => turn.turnId === secondTurnId)?.parentTurnId).toBe(
      submittedTurnId(h.sent, 's1'),
    );
  });

  it('refuses an interior fork while no provider checkpoint exists', async () => {
    const h = await startedHarness();
    await submitPrompt(h, 's1', 'first');
    const firstTurnId = submittedTurnId(h.sent, 's1');
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();
    await submitPrompt(h, 's2', 'second');
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();

    await submitPrompt(h, 's3', 'fork attempt', {
      parentTurnId: firstTurnId,
      expectedGraphRevision: 2,
    });

    expect(failure(h.sent, 's3').code).toBe('unsupported');
    expect(await h.conversationStore.listTurns(h.sessionId)).toHaveLength(2);
  });

  it('forks after the parent turn’s live checkpoint into a new run and records the sibling', async () => {
    const h = await startedHarness(() => new ForkingAdapter());
    const firstTurnId = await twoCheckpointedTurns(h);

    await submitPrompt(h, 's3', 'edited second', {
      parentTurnId: firstTurnId,
      expectedGraphRevision: 2,
    });
    await vi.waitFor(() => submittedTurnId(h.sent, 's3'));

    const forked = forkedAdapter(h.adapters);
    expect(forked.branchedFrom).toEqual({ historyId: 'native-1', cursor: 'cp-1' });
    expect(forked.sentInputs).toEqual([
      { type: 'prompt', content: [{ type: 'text', text: 'edited second' }] },
    ]);
    expect(h.adapter.stopped).toBe(true);
    const forkedTurnId = submittedTurnId(h.sent, 's3');
    const turns = await h.conversationStore.listTurns(h.sessionId);
    const forkedTurn = nullthrow(turns.find((turn) => turn.turnId === forkedTurnId));
    expect(forkedTurn).toMatchObject({
      parentTurnId: firstTurnId,
      siblingOrdinal: 2,
      state: 'running',
    });
    const [record] = await h.store.load();
    expect(record.runs.at(-1)).toMatchObject({
      runId: forkedTurn.runId,
      baseTurnId: firstTurnId,
      historyId: 'native-child',
    });
    expect(record.activeLeafTurnId).toBe(forkedTurnId);
  });

  it('refuses typed at fork time when the checkpoint is no longer valid, leaving a failed sibling', async () => {
    const h = await startedHarness(() => {
      const adapter = new ForkingAdapter();
      adapter.failFork = new HistoryCheckpointInvalidError(
        'claude-code: checkpoint row-b is no longer in transcript native-1',
      );
      return adapter;
    });
    const firstTurnId = await twoCheckpointedTurns(h);

    await submitPrompt(h, 's3', 'edited second', {
      parentTurnId: firstTurnId,
      expectedGraphRevision: 2,
    });
    await vi.waitFor(() => failure(h.sent, 's3'));

    expect(failure(h.sent, 's3')).toMatchObject({
      code: 'unsupported',
      message: 'claude-code: checkpoint row-b is no longer in transcript native-1',
    });
    const turns = await h.conversationStore.listTurns(h.sessionId);
    expect(turns).toHaveLength(3);
    expect(
      turns.find((turn) => turn.siblingOrdinal === 2 && turn.parentTurnId === firstTurnId),
    ).toMatchObject({ state: 'failed' });
    expect(h.adapters.every((adapter) => (adapter as ForkingAdapter).branchedFrom === null)).toBe(
      true,
    );
  });

  it('refuses a fork on a harness without forkAfterTurn even when a checkpoint exists', async () => {
    const h = await startedHarness();
    const firstTurnId = await twoCheckpointedTurns(h);
    expect(await h.conversationStore.listBindings(firstTurnId)).toHaveLength(1);

    await submitPrompt(h, 's3', 'edited second', {
      parentTurnId: firstTurnId,
      expectedGraphRevision: 2,
    });

    expect(failure(h.sent, 's3')).toMatchObject({
      code: 'unsupported',
      message: 'claude-code: forking from an earlier turn is not supported',
    });
    expect(await h.conversationStore.listTurns(h.sessionId)).toHaveLength(2);
  });

  it('continues an inactive tip by resuming the history its own run wrote to', async () => {
    const h = await startedHarness();
    await submitPrompt(h, 's1', 'first');
    const firstTurnId = submittedTurnId(h.sent, 's1');
    h.adapter.emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();
    await submitPrompt(h, 's2', 'new root', { parentTurnId: null, expectedGraphRevision: 1 });
    await vi.waitFor(() => submittedTurnId(h.sent, 's2'));
    const fresh = nullthrow(h.adapters[1]);
    fresh.emit({ type: 'session-ref', historyId: asHistoryId('native-2') });
    fresh.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();

    await submitPrompt(h, 's3', 'continue the old version', {
      parentTurnId: firstTurnId,
      expectedGraphRevision: 2,
    });
    await vi.waitFor(() => submittedTurnId(h.sent, 's3'));

    const resumed = nullthrow(h.adapters.find((adapter) => adapter.resumedFrom === 'native-1'));
    expect(resumed.sentInputs).toEqual([
      { type: 'prompt', content: [{ type: 'text', text: 'continue the old version' }] },
    ]);
    const turns = await h.conversationStore.listTurns(h.sessionId);
    expect(turns.find((turn) => turn.turnId === submittedTurnId(h.sent, 's3'))).toMatchObject({
      parentTurnId: firstTurnId,
      siblingOrdinal: 1,
      state: 'running',
    });
  });

  it('forks — never resumes — an inactive tip that has a live checkpoint', async () => {
    const h = await startedHarness(() => new ForkingAdapter());
    await submitPrompt(h, 's1', 'first');
    const firstTurnId = submittedTurnId(h.sent, 's1');
    h.adapter.emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
    h.adapter.emitCheckpoint({
      historyId: asHistoryId('native-1'),
      cursor: 'cp-1',
      turn: 'ending',
    });
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();
    await submitPrompt(h, 's2', 'new root', { parentTurnId: null, expectedGraphRevision: 1 });
    await vi.waitFor(() => submittedTurnId(h.sent, 's2'));
    const fresh = nullthrow(h.adapters[1]);
    fresh.emit({ type: 'session-ref', historyId: asHistoryId('native-2') });
    fresh.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();

    await submitPrompt(h, 's3', 'continue the old version', {
      parentTurnId: firstTurnId,
      expectedGraphRevision: 2,
    });
    await vi.waitFor(() => submittedTurnId(h.sent, 's3'));

    // pi branches in place: the file's current leaf may be another lineage, so a tip with a
    // checkpoint goes through the checkpoint, not through a resume of "its" history.
    expect(forkedAdapter(h.adapters).branchedFrom).toEqual({
      historyId: 'native-1',
      cursor: 'cp-1',
    });
    expect(h.adapters.some((adapter) => adapter.resumedFrom === 'native-1')).toBe(false);
  });

  it('replays the fork cut from an aligned cold read when no live checkpoint was captured', async () => {
    const h = await startedHarness(
      () =>
        new AlignedHistoryAdapter([
          { text: 'first', cursor: 'before-first' },
          { text: 'second', cursor: 'before-second' },
        ]),
    );
    await submitPrompt(h, 's1', 'first');
    const firstTurnId = submittedTurnId(h.sent, 's1');
    h.adapter.emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();
    await submitPrompt(h, 's2', 'second');
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();

    await submitPrompt(h, 's3', 'edited second', {
      parentTurnId: firstTurnId,
      expectedGraphRevision: 2,
    });
    await vi.waitFor(() => submittedTurnId(h.sent, 's3'));

    // "Before the second prompt" is "after the first turn": the successor row's own cursor.
    expect(forkedAdapter(h.adapters).branchedFrom).toEqual({
      historyId: 'native-1',
      cursor: 'before-second',
    });
    expect(await h.conversationStore.listBindings(firstTurnId)).toEqual([
      expect.objectContaining({
        historyId: 'native-1',
        checkpoint: 'before-second',
        capturedFrom: 'replay',
      }),
    ]);
  });

  it('keeps a fork unavailable when the cold read mints no cursors (a paginated codex rollout)', async () => {
    const h = await startedHarness(
      () => new AlignedHistoryAdapter([{ text: 'first' }, { text: 'second' }]),
    );
    await submitPrompt(h, 's1', 'first');
    const firstTurnId = submittedTurnId(h.sent, 's1');
    h.adapter.emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();
    await submitPrompt(h, 's2', 'second');
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();

    await submitPrompt(h, 's3', 'edited second', {
      parentTurnId: firstTurnId,
      expectedGraphRevision: 2,
    });
    await vi.waitFor(() => failure(h.sent, 's3'));

    expect(failure(h.sent, 's3')).toMatchObject({
      code: 'unsupported',
      message: 'This turn has no provider checkpoint to fork from',
    });
    expect(await h.conversationStore.listTurns(h.sessionId)).toHaveLength(2);
    expect(await h.conversationStore.listBindings(firstTurnId)).toEqual([]);
  });

  it('persists the intent before dispatch and replays the stored failure', async () => {
    const h = await startedHarness(() => new RejectingTurnAdapter());

    await submitPrompt(h, 's1', 'doomed');

    const stored = failure(h.sent, 's1');
    expect(stored.code).toBe('operation_failed');
    const [turn] = await h.conversationStore.listTurns(h.sessionId);
    expect(turn.state).toBe('failed');
    // The dispatcher broadcast the rejection into the conversation, and the reply says so — the
    // client must not raise the failure a second time.
    expect(
      h.sent.some(
        (p) => p.kind === 'agent.event' && p.sessionId === h.sessionId && p.event.type === 'error',
      ),
    ).toBe(true);
    expect(stored.reportedInConversation).toBe(true);

    // Same operationId as s1 replays the stored error without touching the adapter again. A replay
    // has no live event behind it, so it does not claim the conversation reported it.
    await h.inject({
      kind: 'turn.submit',
      clientReqId: 's1-replay',
      sessionId: h.sessionId,
      operationId: OperationIdSchema.parse('op-s1'),
      input: { type: 'prompt', blocks: [{ type: 'text', text: 'doomed' }] },
    });
    const replayed = failure(h.sent, 's1-replay');
    expect(replayed.code).toBe(stored.code);
    expect(replayed.message).toBe(stored.message);
    expect(replayed.reportedInConversation).toBeUndefined();
    expect(h.adapter.sentInputs).toHaveLength(1);
  });

  it('refuses a replay whose operation id belongs to another session', async () => {
    const h = await startedHarness();
    await submitPrompt(h, 's1', 'hello');
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r2',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const otherSessionId = startedId(h.sent, 'r2');

    await h.inject({
      kind: 'turn.submit',
      clientReqId: 's1-elsewhere',
      sessionId: otherSessionId,
      operationId: OperationIdSchema.parse('op-s1'),
      input: { type: 'prompt', blocks: [{ type: 'text', text: 'hello' }] },
    });

    expect(failure(h.sent, 's1-elsewhere')).toMatchObject({ code: 'invalid_request' });
    expect(await h.conversationStore.listTurns(otherSessionId)).toHaveLength(0);
    expect(
      (await h.conversationStore.getOperation(OperationIdSchema.parse('op-s1')))?.sessionId,
    ).toBe(h.sessionId);
  });

  it('keeps ordinals stable across failed siblings', async () => {
    const h = await startedHarness(() => new RejectOnceAdapter());

    await submitPrompt(h, 's1', 'first try');
    await submitPrompt(h, 's2', 'second try');

    const turns = await h.conversationStore.listTurns(h.sessionId);
    expect(turns).toHaveLength(2);
    expect(turns.map((turn) => [turn.siblingOrdinal, turn.state]).sort()).toEqual([
      [1, 'failed'],
      [2, 'running'],
    ]);
    expect(new Set(turns.map((turn) => turn.parentTurnId))).toEqual(new Set([null]));
  });

  it('starts a fresh provider session for a null-parent submit', async () => {
    const h = await startedHarness();
    await submitPrompt(h, 's1', 'first');
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();

    await submitPrompt(h, 's2', 'new root', { parentTurnId: null, expectedGraphRevision: 1 });
    await vi.waitFor(() => submittedTurnId(h.sent, 's2'));

    const rootTurnId = submittedTurnId(h.sent, 's2');
    expect(h.adapter.stopped).toBe(true);
    const replacement = nullthrow(h.adapters[1]);
    expect(replacement.startedWith).not.toBeNull();
    expect(replacement.resumedFrom).toBeNull();
    expect(replacement.sentInputs).toEqual([
      { type: 'prompt', content: [{ type: 'text', text: 'new root' }] },
    ]);
    const turns = await h.conversationStore.listTurns(h.sessionId);
    expect(turns.find((turn) => turn.turnId === rootTurnId)).toMatchObject({
      parentTurnId: null,
      siblingOrdinal: 2,
      state: 'running',
    });
  });

  it('resumes a cold session for a plain send with an addressable new run', async () => {
    const h = await startedHarness();
    await submitPrompt(h, 's1', 'first');
    const firstTurnId = submittedTurnId(h.sent, 's1');
    h.adapter.emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();
    await h.inject({ kind: 'session.stop', clientReqId: 'stop', sessionId: h.sessionId });

    await submitPrompt(h, 's2', 'wake up');
    await vi.waitFor(() => submittedTurnId(h.sent, 's2'));

    const resumed = nullthrow(h.adapters[1]);
    expect(resumed.resumedFrom).toBe('native-1');
    const secondTurnId = submittedTurnId(h.sent, 's2');
    const turns = await h.conversationStore.listTurns(h.sessionId);
    const second = nullthrow(turns.find((turn) => turn.turnId === secondTurnId));
    expect(second).toMatchObject({ parentTurnId: firstTurnId, state: 'running' });
    const [record] = await h.store.load();
    const run = record.runs.at(-1);
    expect(run?.runId).toBe(second.runId);
    expect(run?.baseTurnId).toBe(firstTurnId);
  });

  it('refuses unknown sessions, unknown parents, and attachment blocks', async () => {
    const h = await startedHarness();

    await h.inject({
      kind: 'turn.submit',
      clientReqId: 's-nosession',
      sessionId: SessionIdSchema.parse('sess-missing'),
      operationId: OperationIdSchema.parse('op-nosession'),
      input: { type: 'prompt', blocks: [{ type: 'text', text: 'x' }] },
    });
    expect(failure(h.sent, 's-nosession').code).toBe('not_found');

    await submitPrompt(h, 's-noparent', 'x', {
      parentTurnId: TurnIdSchema.parse('turn-missing'),
      expectedGraphRevision: 0,
    });
    expect(failure(h.sent, 's-noparent').code).toBe('not_found');

    await h.inject({
      kind: 'turn.submit',
      clientReqId: 's-attachment',
      sessionId: h.sessionId,
      operationId: OperationIdSchema.parse('op-attachment'),
      input: {
        type: 'prompt',
        blocks: [{ type: 'attachment_ref', attachmentId: AttachmentIdSchema.parse('att-1') }],
      },
    });
    expect(failure(h.sent, 's-attachment').code).toBe('unsupported');
    expect(await h.conversationStore.listTurns(h.sessionId)).toHaveLength(0);
  });

  it('resolves the operation when the session stops mid-dispatch, and the next submit is not busy', async () => {
    const h = await startedHarness(secondAdapter(() => new HangingResumeAdapter()));
    await submitPrompt(h, 's1', 'first');
    h.adapter.emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();
    await h.inject({ kind: 'session.stop', clientReqId: 'stop-1', sessionId: h.sessionId });

    // The submit relaunches into an adapter hanging in resume; stopping the session interrupts it.
    await submitPrompt(h, 's2', 'wake up');
    await vi.waitFor(() => expect(h.adapters).toHaveLength(2));
    await h.inject({ kind: 'session.stop', clientReqId: 'stop-2', sessionId: h.sessionId });
    await vi.waitFor(() =>
      expect(h.sent).toContainEqual({ kind: 'request.succeeded', replyTo: 'stop-2' }),
    );

    // The interrupted dispatch left no open operation; a retry replays the stored failure.
    await vi.waitFor(async () => {
      const operation = await h.conversationStore.getOperation(OperationIdSchema.parse('op-s2'));
      expect(operation?.state).toBe('failed');
    });
    await h.inject({
      kind: 'turn.submit',
      clientReqId: 's2-retry',
      sessionId: h.sessionId,
      operationId: OperationIdSchema.parse('op-s2'),
      input: { type: 'prompt', blocks: [{ type: 'text', text: 'wake up' }] },
    });
    expect(failure(h.sent, 's2-retry').code).toBe('cancelled');

    // A fresh submit is admitted and relaunches instead of replying busy.
    await submitPrompt(h, 's3', 'again');
    await vi.waitFor(() => submittedTurnId(h.sent, 's3'));
    expect(nullthrow(h.adapters[2]).resumedFrom).toBe('native-1');
  });

  it('discards a start interrupted by the launch timeout so the next submit relaunches', async () => {
    const h = await startedHarness(secondAdapter(() => new HangingResumeAdapter()));
    await submitPrompt(h, 's1', 'first');
    h.adapter.emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();
    await h.inject({ kind: 'session.stop', clientReqId: 'stop-1', sessionId: h.sessionId });

    // Fake only timers: the Effect clock sleeps on setTimeout, fibers schedule on setImmediate.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const pending = h.inject({
        kind: 'turn.submit',
        clientReqId: 's2',
        sessionId: h.sessionId,
        operationId: OperationIdSchema.parse('op-s2'),
        input: { type: 'prompt', blocks: [{ type: 'text', text: 'wake up' }] },
      });
      // Let the dispatch reach the hung resume, then fire the launch timeout as it stands today.
      while (h.adapters.length < 2) await nextLoopTurn();
      await vi.advanceTimersByTimeAsync(360_000);
      await pending;
    } finally {
      vi.useRealTimers();
    }

    await vi.waitFor(() =>
      expect(failure(h.sent, 's2')).toMatchObject({
        code: 'timeout',
        message: 'The provider did not start in time',
      }),
    );
    // The interrupted start was discarded — no registered zombie holding an unstarted adapter.
    await vi.waitFor(() => expect(nullthrow(h.adapters[1]).stopped).toBe(true));

    await submitPrompt(h, 's3', 'again');
    await vi.waitFor(() => submittedTurnId(h.sent, 's3'));
    expect(nullthrow(h.adapters[2]).resumedFrom).toBe('native-1');
  });

  it('tolerates a launch slower than the dispatch timer but within the launch budget', async () => {
    const h = await startedHarness(secondAdapter(() => new GatedResumeAdapter()));
    await submitPrompt(h, 's1', 'first');
    h.adapter.emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();
    await h.inject({ kind: 'session.stop', clientReqId: 'stop-1', sessionId: h.sessionId });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const pending = submitPrompt(h, 's2', 'wake up');
      while (h.adapters.length < 2) await nextLoopTurn();
      // Past the retired flat 60s budget, well under the launch budget: the claude peak cold-start.
      await vi.advanceTimersByTimeAsync(120_000);
      const gated = h.adapters[1];
      if (!(gated instanceof GatedResumeAdapter)) throw new Error('expected the gated adapter');
      gated.releaseResume();
      await pending;
    } finally {
      vi.useRealTimers();
    }

    await vi.waitFor(() => submittedTurnId(h.sent, 's2'));
    const resumed = nullthrow(h.adapters[1]);
    expect(resumed.resumedFrom).toBe('native-1');
    expect(resumed.sentInputs).toEqual([
      { type: 'prompt', content: [{ type: 'text', text: 'wake up' }] },
    ]);
    const operation = await h.conversationStore.getOperation(OperationIdSchema.parse('op-s2'));
    expect(operation?.state).toBe('succeeded');
  });

  it('commits the turn when the dispatch timer fires while the adapter is visibly running', async () => {
    const h = await startedHarness(() => new WholeTurnSendAdapter());

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const pending = submitPrompt(h, 's1', 'long turn');
      while (h.adapter.sentInputs.length === 0) await nextLoopTurn();
      await vi.advanceTimersByTimeAsync(60_000);
      await pending;
    } finally {
      vi.useRealTimers();
    }

    await vi.waitFor(() => submittedTurnId(h.sent, 's1'));
    const turnId = submittedTurnId(h.sent, 's1');
    expect((await h.conversationStore.listTurns(h.sessionId))[0]).toMatchObject({
      turnId,
      state: 'running',
    });
    // Exactly one commit: the rescue's graph move, no second one from any surviving continuation.
    expect(h.sent.filter((p) => p.kind === 'conversation.graph.changed')).toHaveLength(1);

    // The rescued turn settles through the adapter's own stop frame.
    h.adapter.emit({ type: 'stop', stopReason: 'end_turn' });
    await settleEngineTasks();
    expect((await h.conversationStore.listTurns(h.sessionId))[0].state).toBe('completed');
    const operation = await h.conversationStore.getOperation(OperationIdSchema.parse('op-s1'));
    expect(operation?.state).toBe('succeeded');
  });

  it('fails the dispatch timer when the adapter never reported running', async () => {
    const h = await startedHarness(() => new SilentHangingSendAdapter());

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const pending = submitPrompt(h, 's1', 'doomed');
      while (h.adapter.sentInputs.length === 0) await nextLoopTurn();
      await vi.advanceTimersByTimeAsync(60_000);
      await pending;
    } finally {
      vi.useRealTimers();
    }

    await vi.waitFor(() =>
      expect(failure(h.sent, 's1')).toMatchObject({
        code: 'timeout',
        message: 'The provider did not accept the turn in time',
      }),
    );
    const operation = await h.conversationStore.getOperation(OperationIdSchema.parse('op-s1'));
    expect(operation?.state).toBe('failed');
  });
});
