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
  SessionId,
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

/** send() spans the whole turn (pi/grok): `running`, then a gate, then the turn's own checkpoint,
 * stop, and idle — all before it resolves. */
class GatedWholeTurnAdapter extends ForkingAdapter {
  release: () => void = noop;

  override async send(input: AgentInput): Promise<void> {
    this.sentInputs.push(input);
    if (input.type !== 'prompt') return;
    this.emit({ type: 'status', status: 'running' });
    await new Promise<void>((resolve) => {
      this.release = resolve;
    });
    const text = input.content[0]?.type === 'text' ? input.content[0].text : 'prompt';
    this.emitCheckpoint({
      historyId: asHistoryId('native-1'),
      cursor: `after-${text}`,
      turn: 'ending',
    });
    this.emit({ type: 'stop', stopReason: 'end_turn' });
    this.emit({ type: 'status', status: 'idle' });
  }
}

/** The real adapters' rejection shape: `running` at dispatch, a bare `idle` on the provider's
 * refusal, then the send rejects (opencode promptAsync error, claude createQuery throw, pi). */
class RunIdleRejectAdapter extends FakeAdapter {
  override send(input: AgentInput): Promise<void> {
    this.sentInputs.push(input);
    this.emit({ type: 'status', status: 'running' });
    this.emit({ type: 'status', status: 'idle' });
    return Promise.reject(new Error('provider refused the prompt'));
  }
}

/** A forking adapter whose provider refuses cuts on the histories in `dead` — a deleted transcript. */
class DeadHistoryForkingAdapter extends ForkingAdapter {
  constructor(private readonly dead: ReadonlySet<string>) {
    super();
  }

  override branchHistory(opts: AgentHistoryBranchOptions, startOpts: StartOptions): Promise<void> {
    if (this.dead.has(opts.historyId)) {
      return Promise.reject(
        new HistoryCheckpointInvalidError(`claude-code: transcript ${opts.historyId} is gone`),
      );
    }
    return super.branchHistory(opts, startOpts);
  }
}

class LegacyBranchOnlyAdapter extends ForkingAdapter {
  override readonly historyCapabilities: AgentHistoryCapabilities = {
    list: false,
    read: true,
    resume: true,
    forkAfterTurn: false,
    branch: true,
  };
}

type HistoryRow = { text: string; cursor?: string };

/** Cold reads return the lineage's own prompts (one row set, or one per history id); a row
 * without a cursor models a rollout the provider cannot fork (codex `history_mode: paginated`). */
class AlignedHistoryAdapter extends ForkingAdapter {
  constructor(private readonly rows: HistoryRow[] | Record<string, HistoryRow[]>) {
    super();
  }

  override readHistory(opts: AgentHistoryReadOptions): Promise<AgentHistoryReadResult> {
    const rows = Array.isArray(this.rows) ? this.rows : (this.rows[opts.historyId] ?? []);
    return Promise.resolve({
      session: { historyId: opts.historyId, kind: this.kind, cwd: '/repo' },
      events: rows.map((row, index) => ({
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

/** The live echo of prompt `text`, as a ≤v79 client would hand it back to `history.branch`. */
function livePrompt(sent: WirePayload[], sessionId: SessionId, text: string) {
  const event = sent
    .flatMap((payload) =>
      payload.kind === 'agent.event' && payload.sessionId === sessionId ? [payload.event] : [],
    )
    .findLast(
      (candidate) =>
        candidate.type === 'user-message' &&
        candidate.branchCursor !== undefined &&
        candidate.content[0]?.type === 'text' &&
        candidate.content[0].text === text,
    );
  if (event?.type !== 'user-message' || event.branchCursor === undefined) {
    throw new Error(`no live prompt echo for ${text}`);
  }
  return { sourceMessageId: event.messageId, branchCursor: event.branchCursor };
}

/** Every fork the harness performed, in order. */
function forks(adapters: FakeAdapter[]): AgentHistoryBranchOptions[] {
  return adapters.flatMap((adapter) =>
    adapter instanceof ForkingAdapter && adapter.branchedFrom !== null
      ? [adapter.branchedFrom]
      : [],
  );
}

/** A session older than its turn rows: provider history exists, no turn was ever recorded. */
async function preExistingSession(rows: HistoryRow[] | Record<string, HistoryRow[]>) {
  const h = await startedHarness(() => new AlignedHistoryAdapter(rows));
  h.adapter.emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
  await h.inject({ kind: 'session.stop', clientReqId: 'stop-0', sessionId: h.sessionId });
  // The first post-upgrade prompt: a graph root on the resume run, hidden history behind it.
  await submitPrompt(h, 's1', 'first');
  await vi.waitFor(() => submittedTurnId(h.sent, 's1'));
  const resumed = nullthrow(h.adapters[1]);
  resumed.emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
  resumed.emit({ type: 'status', status: 'idle' });
  await settleEngineTasks();
  return { ...h, firstTurnId: submittedTurnId(h.sent, 's1') };
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
    // The echo carries the durable row's identity, so a later conversation.read converges on it.
    expect(
      h.sent.filter(
        (payload) => payload.kind === 'agent.event' && payload.event.type === 'user-message',
      ),
    ).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({ type: 'user-message', messageId: `msg-${turnId}` }),
      }),
    ]);
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
      message: 'The provider no longer honours this fork checkpoint',
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

  it('falls back to the parent’s binding on the current history when its own run’s history is dead', async () => {
    const dead = new Set<string>();
    const h = await startedHarness(() => new DeadHistoryForkingAdapter(dead));
    const firstTurnId = await twoCheckpointedTurns(h);
    await submitPrompt(h, 's3', 'edited second', {
      parentTurnId: firstTurnId,
      expectedGraphRevision: 2,
    });
    await vi.waitFor(() => submittedTurnId(h.sent, 's3'));
    forkedAdapter(h.adapters).emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();
    // The child history carries the parent's copy; a cold read of it backfilled the parent there.
    const turns = await h.conversationStore.listTurns(h.sessionId);
    const { runId } = nullthrow(turns.find((turn) => turn.turnId === firstTurnId));
    await h.conversationStore.saveBinding({
      turnId: firstTurnId,
      runId,
      historyId: 'native-child',
      checkpoint: 'child-cp-1',
      capturedFrom: 'replay',
    });
    dead.add('native-1');

    await submitPrompt(h, 's4', 'edited again', {
      parentTurnId: firstTurnId,
      expectedGraphRevision: 3,
    });
    await vi.waitFor(() => submittedTurnId(h.sent, 's4'));

    // The live capture on the parent's own history is tried first; its refusal moves the fork to
    // the same turn's cut on the history the session actually runs on.
    expect(forks(h.adapters)).toEqual([
      { historyId: 'native-1', cursor: 'cp-1' },
      { historyId: 'native-child', cursor: 'child-cp-1' },
    ]);
    expect(await h.conversationStore.listTurns(h.sessionId)).toHaveLength(4);
  });

  it('picks the parent’s binding on the current history, not the first stored one, when its own run captured none', async () => {
    const h = await startedHarness(() => new ForkingAdapter());
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
    const turns = await h.conversationStore.listTurns(h.sessionId);
    const { runId } = nullthrow(turns.find((turn) => turn.turnId === firstTurnId));
    const replay = { turnId: firstTurnId, runId, capturedFrom: 'replay' as const };
    await h.conversationStore.saveBinding({
      ...replay,
      historyId: 'native-stale',
      checkpoint: 'stale-cp',
    });
    await h.conversationStore.saveBinding({
      ...replay,
      historyId: 'native-2',
      checkpoint: 'current-cp',
    });

    await submitPrompt(h, 's3', 'continue the old version', {
      parentTurnId: firstTurnId,
      expectedGraphRevision: 2,
    });
    await vi.waitFor(() => submittedTurnId(h.sent, 's3'));

    expect(forks(h.adapters)).toEqual([{ historyId: 'native-2', cursor: 'current-cp' }]);
  });

  it('refuses a fork on a harness without forkAfterTurn even when a checkpoint exists', async () => {
    // The opencode shape: the legacy `branch` path stays advertised, turn-level forks are dark.
    const h = await startedHarness(() => new LegacyBranchOnlyAdapter());
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

    // The tip's history may have grown outside LinkCode since, so a tip with a checkpoint goes
    // through the checkpoint, not through a resume of "its" history.
    expect(forkedAdapter(h.adapters).branchedFrom).toEqual({
      historyId: 'native-1',
      cursor: 'cp-1',
    });
    expect(h.adapters.some((adapter) => adapter.resumedFrom === 'native-1')).toBe(false);
  });

  it('a send rejected after `running` and `idle` fails the turn — never a phantom success', async () => {
    const h = await startedHarness(() => new RunIdleRejectAdapter());

    await submitPrompt(h, 's1', 'doomed');

    expect(failure(h.sent, 's1').code).toBe('operation_failed');
    const operation = await h.conversationStore.getOperation(OperationIdSchema.parse('op-s1'));
    expect(operation?.state).toBe('failed');
    expect((await h.conversationStore.listTurns(h.sessionId))[0].state).toBe('failed');
    // The failed turn keeps its ordinal, so the tree's shape is announced — without a leaf move.
    expect(h.sent.filter((p) => p.kind === 'conversation.graph.changed')).toEqual([
      { kind: 'conversation.graph.changed', sessionId: h.sessionId, graphRevision: 1 },
    ]);
    const [record] = await h.store.load();
    expect(record.activeLeafTurnId).toBeUndefined();

    // The same through the legacy input path.
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'legacy',
      sessionId: h.sessionId,
      input: { type: 'prompt', content: [{ type: 'text', text: 'doomed again' }] },
    });
    expect(failure(h.sent, 'legacy').code).toBe('operation_failed');
    expect((await h.conversationStore.listTurns(h.sessionId)).map((turn) => turn.state)).toEqual([
      'failed',
      'failed',
    ]);
    expect(await h.conversationStore.listOpenOperations(h.sessionId)).toHaveLength(0);
    expect(h.sent.filter((p) => p.kind === 'conversation.graph.changed')).toEqual([
      { kind: 'conversation.graph.changed', sessionId: h.sessionId, graphRevision: 1 },
      { kind: 'conversation.graph.changed', sessionId: h.sessionId, graphRevision: 2 },
    ]);
  });

  it('starts a new root fresh when the created session’s earlier run never wrote provider history', async () => {
    const h = await startedHarness(() => new ForkingAdapter());
    // Run 1 dies before its first prompt, so the graph root lands on run 2.
    await h.inject({ kind: 'session.stop', clientReqId: 'stop-0', sessionId: h.sessionId });
    await submitPrompt(h, 's1', 'first');
    await vi.waitFor(() => submittedTurnId(h.sent, 's1'));
    const second = nullthrow(h.adapters[1]);
    second.emit({ type: 'session-ref', historyId: asHistoryId('native-2') });
    second.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();

    await submitPrompt(h, 's2', 'new root', { parentTurnId: null, expectedGraphRevision: 1 });
    await vi.waitFor(() => submittedTurnId(h.sent, 's2'));

    // No earlier run left provider rows behind the root, so there is no hidden history to fork after.
    const fresh = nullthrow(h.adapters[2]) as ForkingAdapter;
    expect(fresh.startedWith).not.toBeNull();
    expect(fresh.branchedFrom).toBeNull();
    expect(fresh.resumedFrom).toBeNull();
    expect(fresh.sentInputs).toEqual([
      { type: 'prompt', content: [{ type: 'text', text: 'new root' }] },
    ]);
  });

  it('refuses to resume a checkpoint-less inactive tip on a forking harness', async () => {
    const h = await startedHarness(() => new ForkingAdapter());
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

    // Its own run's history may have grown outside LinkCode (or the capture was lost): a blind
    // resume would land the prompt on unknown content.
    expect(failure(h.sent, 's3')).toMatchObject({
      code: 'unsupported',
      message: 'This turn has no provider checkpoint to continue from',
    });
    expect(h.adapters.some((adapter) => adapter.resumedFrom === 'native-1')).toBe(false);
    expect(await h.conversationStore.listTurns(h.sessionId)).toHaveLength(2);
  });

  it('tracks a whole-turn send as running before it resolves, so its own stop settles it and it stays forkable', async () => {
    const h = await startedHarness(() => new GatedWholeTurnAdapter());
    const adapter = h.adapter as GatedWholeTurnAdapter;
    adapter.emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
    await submitPrompt(h, 's1', 'first');

    // Tracked off the adapter's `running` while send() is still in flight: the status frame is
    // stamped with the turn — but nothing is committed until the dispatch resolves.
    await vi.waitFor(() => expect(adapter.sentInputs).toHaveLength(1));
    const [preparing] = await h.conversationStore.listTurns(h.sessionId);
    expect(preparing.state).toBe('preparing');
    expect(h.sent).toContainEqual(
      expect.objectContaining({
        kind: 'agent.event',
        turnId: preparing.turnId,
        event: { type: 'status', status: 'running' },
      }),
    );
    expect(h.sent.filter((p) => p.kind === 'conversation.graph.changed')).toHaveLength(0);
    adapter.release();
    await vi.waitFor(() => submittedTurnId(h.sent, 's1'));
    const firstTurnId = submittedTurnId(h.sent, 's1');
    await settleEngineTasks();
    // One commit, and the turn's own stop (held until then) settled THIS turn with its checkpoint.
    expect((await h.conversationStore.listTurns(h.sessionId))[0].state).toBe('completed');
    expect(await h.conversationStore.listBindings(firstTurnId)).toEqual([
      expect.objectContaining({ checkpoint: 'after-first', capturedFrom: 'live' }),
    ]);
    expect(h.sent.filter((p) => p.kind === 'conversation.graph.changed')).toHaveLength(1);

    await submitPrompt(h, 's2', 'second');
    await vi.waitFor(() => expect(adapter.sentInputs).toHaveLength(2));
    adapter.release();
    await vi.waitFor(() => submittedTurnId(h.sent, 's2'));
    await settleEngineTasks();
    // Stopping the idle session leaves the finished turns alone — nothing is stranded `running`.
    await h.inject({ kind: 'session.stop', clientReqId: 'stop', sessionId: h.sessionId });
    expect((await h.conversationStore.listTurns(h.sessionId)).map((turn) => turn.state)).toEqual([
      'completed',
      'completed',
    ]);

    await submitPrompt(h, 's3', 'edited second', {
      parentTurnId: firstTurnId,
      expectedGraphRevision: 2,
    });
    await vi.waitFor(() => expect(forkedAdapter(h.adapters).sentInputs).toHaveLength(1));
    (forkedAdapter(h.adapters) as GatedWholeTurnAdapter).release();
    await vi.waitFor(() => submittedTurnId(h.sent, 's3'));
    expect(forkedAdapter(h.adapters).branchedFrom).toEqual({
      historyId: 'native-1',
      cursor: 'after-first',
    });
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

  it('forks the first post-upgrade prompt of a pre-existing session after its hidden history — never fresh', async () => {
    const h = await preExistingSession([
      { text: 'hidden one', cursor: 'before-hidden' },
      { text: 'first', cursor: 'before-first' },
    ]);

    await submitPrompt(h, 's2', 'edited first', { parentTurnId: null, expectedGraphRevision: 1 });
    await vi.waitFor(() => submittedTurnId(h.sent, 's2'));

    // The cut is the root's own row on the provider: everything before it stays in context.
    expect(forks(h.adapters)).toEqual([{ historyId: 'native-1', cursor: 'before-first' }]);
    const turns = await h.conversationStore.listTurns(h.sessionId);
    expect(turns.find((turn) => turn.turnId === submittedTurnId(h.sent, 's2'))).toMatchObject({
      parentTurnId: null,
      siblingOrdinal: 2,
      state: 'running',
    });
  });

  it('refuses typed, never fresh, when a pre-existing session’s hidden history cannot be aligned', async () => {
    const h = await preExistingSession([
      { text: 'hidden one', cursor: 'before-hidden' },
      { text: 'not the first prompt', cursor: 'before-other' },
    ]);

    await submitPrompt(h, 's2', 'edited first', { parentTurnId: null, expectedGraphRevision: 1 });

    expect(failure(h.sent, 's2')).toMatchObject({
      code: 'unsupported',
      message: 'This turn has no provider checkpoint to fork from',
    });
    expect(forks(h.adapters)).toEqual([]);
    // No fresh start either: the only adapters ever started are the original and the resume.
    expect(
      h.adapters.filter((adapter) => adapter.startedWith !== null || adapter.resumedFrom !== null),
    ).toHaveLength(2);
  });

  it('legacy rewrite of a pre-existing session’s first recorded prompt forks after the hidden history, and again after an edit', async () => {
    const h = await preExistingSession({
      'native-1': [
        { text: 'hidden one', cursor: 'before-hidden' },
        { text: 'first', cursor: 'before-first' },
      ],
      'native-child': [
        { text: 'hidden one', cursor: 'before-hidden' },
        { text: 'first, edited', cursor: 'before-edited' },
      ],
    });
    const original = livePrompt(h.sent, h.sessionId, 'first');

    await h.inject({
      kind: 'history.branch',
      clientReqId: 'rewrite-1',
      sourceSessionId: h.sessionId,
      ...original,
      content: [{ type: 'text', text: 'first, edited' }],
    });
    await vi.waitFor(() =>
      expect(h.sent).toContainEqual(
        expect.objectContaining({ kind: 'session.started', replyTo: 'rewrite-1' }),
      ),
    );
    nullthrow(h.adapters.at(-1)).emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();

    // The original root is off the active path now; it shares its predecessor with the active
    // root, so its cut is that sibling's row on the current (forked) history.
    await h.inject({
      kind: 'history.branch',
      clientReqId: 'rewrite-2',
      sourceSessionId: h.sessionId,
      ...original,
      content: [{ type: 'text', text: 'first, edited again' }],
    });
    await vi.waitFor(() =>
      expect(h.sent).toContainEqual(
        expect.objectContaining({ kind: 'session.started', replyTo: 'rewrite-2' }),
      ),
    );

    expect(forks(h.adapters)).toEqual([
      { historyId: 'native-1', cursor: 'before-first' },
      { historyId: 'native-child', cursor: 'before-edited' },
    ]);
    const turns = await h.conversationStore.listTurns(h.sessionId);
    expect(turns.map((turn) => [turn.parentTurnId, turn.siblingOrdinal])).toEqual([
      [null, 1],
      [null, 2],
      [null, 3],
    ]);
  });

  it('forks the first post-import prompt of an imported-then-continued session at its own row', async () => {
    const conversationStore = new InMemoryConversationStore();
    const h = harness(
      new InMemorySessionStore(),
      () =>
        new AlignedHistoryAdapter([
          { text: 'imported one', cursor: 'before-imported' },
          { text: 'first', cursor: 'before-first' },
        ]),
      undefined,
      undefined,
      undefined,
      undefined,
      { conversationStore },
    );
    await h.engine.start();
    await h.inject({
      kind: 'history.resume',
      clientReqId: 'r1',
      agentKind: 'claude-code',
      historyId: asHistoryId('native-1'),
      startOpts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(h.sent, 'r1');
    const imported = { ...h, conversationStore, sessionId, adapter: nullthrow(h.adapters[0]) };
    await submitPrompt(imported, 's1', 'first');
    imported.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();

    await submitPrompt(imported, 's2', 'edited first', {
      parentTurnId: null,
      expectedGraphRevision: 1,
    });
    await vi.waitFor(() => submittedTurnId(h.sent, 's2'));

    expect(forks(h.adapters)).toEqual([{ historyId: 'native-1', cursor: 'before-first' }]);
  });

  it('forks at the live checkpoint even when the cold-read cursor names a different row', async () => {
    // claude: a Stop hook summary row sits between the last assistant row (the live checkpoint)
    // and the next user row (whose parentUuid is the cold-read cursor); both are valid cuts.
    const h = await startedHarness(
      () =>
        new AlignedHistoryAdapter([
          { text: 'first', cursor: 'before-first' },
          { text: 'second', cursor: 'system-row' },
        ]),
    );
    await submitPrompt(h, 's1', 'first');
    const firstTurnId = submittedTurnId(h.sent, 's1');
    h.adapter.emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
    h.adapter.emitCheckpoint({
      historyId: asHistoryId('native-1'),
      cursor: 'assistant-row',
      turn: 'ending',
    });
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();
    await submitPrompt(h, 's2', 'second');
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();
    // A read attributes the lineage and backfills replay cuts — never over the live one.
    await h.inject({ kind: 'conversation.read', clientReqId: 'rr', sessionId: h.sessionId });
    await settleEngineTasks();
    expect(await h.conversationStore.listBindings(firstTurnId)).toEqual([
      expect.objectContaining({ checkpoint: 'assistant-row', capturedFrom: 'live' }),
    ]);

    await submitPrompt(h, 's3', 'edited second', {
      parentTurnId: firstTurnId,
      expectedGraphRevision: 2,
    });
    await vi.waitFor(() => submittedTurnId(h.sent, 's3'));

    expect(forkedAdapter(h.adapters).branchedFrom).toEqual({
      historyId: 'native-1',
      cursor: 'assistant-row',
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
    expect(failure(h.sent, 's-attachment').code).toBe('unsupported_attachment');
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
