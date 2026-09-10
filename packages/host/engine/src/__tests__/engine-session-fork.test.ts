import { asHistoryId, HistoryCheckpointInvalidError } from '@linkcode/agent-adapter';
import type {
  AgentHistoryBranchOptions,
  AgentHistoryCapabilities,
  AgentHistoryEvent,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  ConversationReadItem,
  MessageId,
  SessionId,
  StartOptions,
  TurnId,
  WirePayload,
} from '@linkcode/schema';
import { OperationIdSchema, SessionIdSchema, TurnIdSchema } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryConversationStore } from '../conversation/conversation-store';
import type { EngineDeps } from '../deps';
import { InMemorySessionStore } from '../session/session-store';
import type { SimulatorMcpProvider } from '../simulator/mcp';
import {
  FakeAdapter,
  createSessionHarness as harness,
  settleEngineTasks,
  startedSessionId as startedId,
} from './fixtures/session-harness';

const SOURCE_HISTORY = asHistoryId('native-1');
const CHILD_HISTORY = asHistoryId('native-child');

type Corpora = Record<string, AgentHistoryEvent[]>;

/** Forks announce the child history at branch time, as the real adapters do; cold reads serve a
 * per-history corpus so the child's copied prefix can be attributed against its own history. */
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

  constructor(private readonly corpora: Corpora = {}) {
    super();
  }

  branchHistory(opts: AgentHistoryBranchOptions, startOpts: StartOptions): Promise<void> {
    if (this.failFork) return Promise.reject(this.failFork);
    this.branchedFrom = opts;
    this.startedWith = startOpts;
    this.emit({ type: 'session-ref', historyId: CHILD_HISTORY });
    return Promise.resolve();
  }

  override readHistory(opts: AgentHistoryReadOptions): Promise<AgentHistoryReadResult> {
    return Promise.resolve({
      session: { historyId: opts.historyId, kind: this.kind, cwd: '/repo' },
      events: this.corpora[opts.historyId] ?? [],
    });
  }
}

/** The provider fork never settles until released. */
class GatedForkAdapter extends ForkingAdapter {
  release: () => void = noop;

  override branchHistory(opts: AgentHistoryBranchOptions): Promise<void> {
    this.branchedFrom = opts;
    return new Promise((resolve) => {
      this.release = resolve;
    });
  }
}

/** The provider fork reports something on the way (claude: subagent transcripts not copied). */
class NoisyForkAdapter extends ForkingAdapter {
  override branchHistory(opts: AgentHistoryBranchOptions, startOpts: StartOptions): Promise<void> {
    this.emit({
      type: 'error',
      message: 'subagent transcripts were not copied',
      code: 'fork_subagents_not_copied',
      recoverable: true,
    });
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

function cursorRow(itemId: string, text: string, branchCursor: string): AgentHistoryEvent {
  return {
    historyId: CHILD_HISTORY,
    itemId,
    event: {
      type: 'user-message',
      messageId: itemId as MessageId,
      content: [{ type: 'text', text }],
      branchCursor,
    },
  };
}

function assistantRow(itemId: string, text: string, ts?: number): AgentHistoryEvent {
  return {
    historyId: CHILD_HISTORY,
    itemId,
    ...(ts !== undefined && { ts }),
    event: {
      type: 'agent-message',
      messageId: itemId as MessageId,
      content: [{ type: 'text', text }],
    },
  };
}

/** Assistant texts of a child read, in order; the row `ts` rides along for the re-stamp check. */
async function readAssistantRows(h: Harness, sessionId: SessionId) {
  const clientReqId = `read-${h.sent.length}`;
  await h.inject({ kind: 'conversation.read', clientReqId, sessionId });
  await settleEngineTasks();
  const reply = h.sent.find(
    (payload) => payload.kind === 'conversation.read.result' && payload.replyTo === clientReqId,
  );
  if (reply?.kind !== 'conversation.read.result') throw new Error('no conversation.read.result');
  return reply.events.flatMap((item: ConversationReadItem) =>
    'event' in item && item.event.type === 'agent-message'
      ? [
          {
            ts: item.ts,
            text: (item.event.content ?? [])
              .flatMap((b) => (b.type === 'text' ? [b.text] : []))
              .join(''),
          },
        ]
      : [],
  );
}

async function startedHarness(
  makeAdapter: () => FakeAdapter = () => new ForkingAdapter(),
  extraDeps: EngineDeps = {},
) {
  const store = new InMemorySessionStore();
  const conversationStore = new InMemoryConversationStore();
  const h = harness(store, makeAdapter, undefined, undefined, undefined, undefined, {
    conversationStore,
    ...extraDeps,
  });
  await h.engine.start();
  await h.inject({
    kind: 'session.start',
    clientReqId: 'r1',
    opts: { kind: 'claude-code', cwd: '/repo' },
  });
  const sessionId = startedId(h.sent, 'r1');
  return { ...h, conversationStore, sessionId, adapter: nullthrow(h.adapters[0]) };
}

type Harness = Awaited<ReturnType<typeof startedHarness>>;

function submitPrompt(
  h: Harness,
  clientReqId: string,
  text: string,
  sessionId: SessionId = h.sessionId,
  extra: Partial<{ parentTurnId: TurnId | null; expectedGraphRevision: number }> = {},
) {
  return h.inject({
    kind: 'turn.submit',
    clientReqId,
    sessionId,
    operationId: OperationIdSchema.parse(`op-${clientReqId}`),
    input: { type: 'prompt', blocks: [{ type: 'text', text }] },
    ...extra,
  });
}

function submittedTurnId(sent: WirePayload[], replyTo: string): TurnId {
  const reply = sent.find(
    (payload) => payload.kind === 'turn.submitted' && payload.replyTo === replyTo,
  );
  if (reply?.kind !== 'turn.submitted') throw new Error(`no turn.submitted for ${replyTo}`);
  return reply.turnId;
}

/** Two settled turns on the source history, each with a live `ending` checkpoint. */
async function twoCheckpointedTurns(
  h: Harness,
  adapter: FakeAdapter = h.adapter,
): Promise<[TurnId, TurnId]> {
  await submitPrompt(h, 's1', 'first');
  const firstTurnId = submittedTurnId(h.sent, 's1');
  adapter.emit({ type: 'session-ref', historyId: SOURCE_HISTORY });
  adapter.emitCheckpoint({ historyId: SOURCE_HISTORY, cursor: 'cp-1', turn: 'ending' });
  adapter.emit({ type: 'status', status: 'idle' });
  await settleEngineTasks();
  await submitPrompt(h, 's2', 'second');
  const secondTurnId = submittedTurnId(h.sent, 's2');
  adapter.emitCheckpoint({ historyId: SOURCE_HISTORY, cursor: 'cp-2', turn: 'ending' });
  adapter.emit({ type: 'status', status: 'idle' });
  await settleEngineTasks();
  return [firstTurnId, secondTurnId];
}

function fork(
  h: Harness,
  clientReqId: string,
  throughTurnId: TurnId,
  expectedGraphRevision: number,
  extra: Partial<{ sourceSessionId: SessionId; operationId: string }> = {},
) {
  return h.inject({
    kind: 'session.fork',
    clientReqId,
    sourceSessionId: extra.sourceSessionId ?? h.sessionId,
    throughTurnId,
    operationId: OperationIdSchema.parse(extra.operationId ?? `op-${clientReqId}`),
    expectedGraphRevision,
  });
}

function forkedSessionId(sent: WirePayload[], replyTo: string): SessionId {
  const reply = sent.find(
    (payload) => payload.kind === 'session.forked' && payload.replyTo === replyTo,
  );
  if (reply?.kind !== 'session.forked') throw new Error(`no session.forked for ${replyTo}`);
  return reply.sessionId;
}

function failure(sent: WirePayload[], replyTo: string) {
  const reply = sent.find(
    (payload) => payload.kind === 'request.failed' && payload.replyTo === replyTo,
  );
  if (reply?.kind !== 'request.failed') throw new Error(`no request.failed for ${replyTo}`);
  return reply;
}

async function listed(h: Harness) {
  const clientReqId = `ls-${h.sent.length}`;
  await h.inject({ kind: 'session.list', clientReqId });
  const reply = h.sent.find(
    (payload) => payload.kind === 'session.listed' && payload.replyTo === clientReqId,
  );
  if (reply?.kind !== 'session.listed') throw new Error('no session.listed reply');
  return reply.sessions;
}

async function readUserTexts(h: Harness, sessionId: SessionId): Promise<string[]> {
  const clientReqId = `read-${h.sent.length}`;
  await h.inject({ kind: 'conversation.read', clientReqId, sessionId });
  await settleEngineTasks();
  const reply = h.sent.find(
    (payload) => payload.kind === 'conversation.read.result' && payload.replyTo === clientReqId,
  );
  if (reply?.kind !== 'conversation.read.result') throw new Error('no conversation.read.result');
  return reply.events.flatMap((item: ConversationReadItem) =>
    'event' in item && item.event.type === 'user-message'
      ? item.event.content.flatMap((block) => (block.type === 'text' ? [block.text] : []))
      : [],
  );
}

/** Every adapter the harness forked with, in order. Counting `adapters` itself is meaningless: cold
 * reads and capability lookups mint throwaway instances. */
function forks(adapters: FakeAdapter[]): ForkingAdapter[] {
  return adapters.filter(
    (adapter): adapter is ForkingAdapter =>
      adapter instanceof ForkingAdapter && adapter.branchedFrom !== null,
  );
}

function forkedAdapter(adapters: FakeAdapter[]): ForkingAdapter {
  return nullthrow(forks(adapters)[0]);
}

describe('session.fork saga', () => {
  it('forks through a completed turn into a live child that copies the lineage and shares its prompts', async () => {
    const h = await startedHarness();
    const [firstTurnId, secondTurnId] = await twoCheckpointedTurns(h);

    await fork(h, 'f1', firstTurnId, 2);
    await vi.waitFor(() => forkedSessionId(h.sent, 'f1'));
    const childId = forkedSessionId(h.sent, 'f1');

    expect(childId).not.toBe(h.sessionId);
    const child = forkedAdapter(h.adapters);
    expect(child.branchedFrom).toEqual({ historyId: SOURCE_HISTORY, cursor: 'cp-1' });
    expect(child.startedWith).toMatchObject({ kind: 'claude-code', cwd: '/repo' });
    // The source is untouched: still live, still on its own leaf and revision.
    expect(h.adapter.stopped).toBe(false);
    expect(h.sent).toContainEqual({
      kind: 'session.changed',
      sessionId: childId,
      reason: 'created',
    });

    const sessions = await listed(h);
    const listedChild = nullthrow(sessions.find((session) => session.sessionId === childId));
    expect(listedChild).toMatchObject({
      kind: 'claude-code',
      cwd: '/repo',
      forkOrigin: { sourceSessionId: h.sessionId, sourceTurnId: firstTurnId },
      historyId: CHILD_HISTORY,
    });
    expect(listedChild.status).not.toBe('stopped');

    const [sourceTurn] = await h.conversationStore.listTurns(h.sessionId);
    const copies = await h.conversationStore.listTurns(childId);
    expect(copies).toHaveLength(1);
    const [copy] = copies;
    expect(copy.turnId).not.toBe(firstTurnId);
    expect(copy).toMatchObject({
      sessionId: childId,
      parentTurnId: null,
      siblingOrdinal: 1,
      input: sourceTurn.input,
      state: 'completed',
      createdAt: sourceTurn.createdAt,
    });
    expect(copy.runId).not.toBe(sourceTurn.runId);
    const records = await h.store.load();
    const childRecord = nullthrow(records.find((record) => record.sessionId === childId));
    expect(childRecord.activeLeafTurnId).toBe(copy.turnId);
    expect(childRecord.graphRevision).toBe(0);
    expect(childRecord.runs).toEqual([
      expect.objectContaining({
        runId: copy.runId,
        baseTurnId: copy.turnId,
        historyId: CHILD_HISTORY,
      }),
    ]);
    const sourceRecord = nullthrow(records.find((record) => record.sessionId === h.sessionId));
    expect(sourceRecord.activeLeafTurnId).toBe(secondTurnId);
    expect(sourceRecord.graphRevision).toBe(2);
    expect(await h.conversationStore.listTurns(h.sessionId)).toHaveLength(2);
    // The shared prompt renders in the child as its own user row.
    expect(await readUserTexts(h, childId)).toEqual(['first']);
    expect(await h.conversationStore.getOperation(OperationIdSchema.parse('op-f1'))).toMatchObject({
      kind: 'session.fork',
      state: 'succeeded',
      turnId: copy.turnId,
    });
  });

  it('resolves the child start options under the child session id', async () => {
    const endpointsFor: SessionId[] = [];
    const simulatorMcp: SimulatorMcpProvider = {
      endpointFor(sessionId) {
        endpointsFor.push(sessionId);
        return { type: 'http', name: 'linkcode-sim', url: `http://127.0.0.1:1/mcp/${sessionId}` };
      },
      release: noop,
    };
    const h = await startedHarness(() => new ForkingAdapter(), { simulatorMcp });
    const [firstTurnId] = await twoCheckpointedTurns(h);

    await fork(h, 'f1', firstTurnId, 2);
    await vi.waitFor(() => forkedSessionId(h.sent, 'f1'));
    const childId = forkedSessionId(h.sent, 'f1');

    // The source's pins carry over, but per-session resources are the child's own.
    expect(endpointsFor.at(-1)).toBe(childId);
    expect(forkedAdapter(h.adapters).startedWith?.mcpServers).toContainEqual(
      expect.objectContaining({ url: `http://127.0.0.1:1/mcp/${childId}` }),
    );
  });

  it('keeps a provisional child out of session notifications', async () => {
    const h = await startedHarness(() => new NoisyForkAdapter());
    const [firstTurnId] = await twoCheckpointedTurns(h);

    await fork(h, 'f1', firstTurnId, 2);
    await vi.waitFor(() => forkedSessionId(h.sent, 'f1'));
    const childId = forkedSessionId(h.sent, 'f1');

    expect(
      h.sent.some(
        (payload) =>
          payload.kind === 'session.notification' && payload.notification.sessionId === childId,
      ),
    ).toBe(false);
  });

  it('a source deleted mid-fork fails the fork typed and leaves no child behind', async () => {
    const h = await startedHarness(() => new GatedForkAdapter());
    const [firstTurnId] = await twoCheckpointedTurns(h);
    await fork(h, 'f1', firstTurnId, 2);
    const gated = await vi.waitFor(() =>
      nullthrow(
        h.adapters.find(
          (adapter): adapter is GatedForkAdapter =>
            adapter instanceof GatedForkAdapter && adapter.branchedFrom !== null,
        ),
      ),
    );

    await h.inject({ kind: 'session.delete', clientReqId: 'del', sessionId: h.sessionId });
    expect(h.sent).toContainEqual({ kind: 'request.succeeded', replyTo: 'del' });
    gated.release();
    await vi.waitFor(() => failure(h.sent, 'f1'));

    expect(failure(h.sent, 'f1')).toMatchObject({
      code: 'not_found',
      message: 'The source session was deleted',
    });
    expect(await h.store.load()).toEqual([]);
    expect(gated.stopped).toBe(true);
    expect(await h.conversationStore.listOpenOperations()).toEqual([]);
  });

  it('re-binds and renders a child of a pre-graph source, whose copy carries the hidden rows', async () => {
    const corpora: Corpora = {
      [SOURCE_HISTORY]: [
        cursorRow('e', 'earlier', 'before-earlier'),
        assistantRow('ea', 'earlier answer'),
        cursorRow('s1', 'first', 'before-first'),
        assistantRow('sa1', 'original first'),
        cursorRow('s2', 'second', 'before-second'),
        assistantRow('sa2', 'original second'),
      ],
      [CHILD_HISTORY]: [
        cursorRow('c0', 'earlier', 'child-before-earlier'),
        assistantRow('ca0', 'copied earlier'),
        cursorRow('c1', 'first', 'child-before-first'),
        assistantRow('ca1', 'copied first'),
        cursorRow('c2', 'second', 'child-before-second'),
        assistantRow('ca2', 'copied second'),
      ],
    };
    const h = await startedHarness(() => new ForkingAdapter(corpora));
    // Provider history before any turn row: the source's first turn sits on a resume run.
    h.adapter.emit({ type: 'session-ref', historyId: SOURCE_HISTORY });
    await h.inject({ kind: 'session.stop', clientReqId: 'stop', sessionId: h.sessionId });
    await h.inject({ kind: 'session.resume', clientReqId: 'resume', sessionId: h.sessionId });
    await vi.waitFor(() => startedId(h.sent, 'resume'));
    const resumed = nullthrow(h.adapters.find((adapter) => adapter.resumedFrom === SOURCE_HISTORY));
    const [, secondTurnId] = await twoCheckpointedTurns(h, resumed);

    await fork(h, 'f1', secondTurnId, 2);
    await vi.waitFor(() => forkedSessionId(h.sent, 'f1'));
    const childId = forkedSessionId(h.sent, 'f1');
    const [copy1, copy2] = await h.conversationStore.listTurns(childId);

    const texts = async () => (await readAssistantRows(h, childId)).map((row) => row.text);
    // The hidden row leads the read as pre-graph history, from the source like the rest.
    expect(await texts()).toEqual(['earlier answer', 'original first', 'original second']);
    // The copy has three user rows for two copied turns; the extra one is the hidden prefix, so
    // the end-anchored alignment still re-binds the prefix.
    expect(await h.conversationStore.listBindings(copy1.turnId)).toEqual([
      expect.objectContaining({
        historyId: CHILD_HISTORY,
        checkpoint: 'child-before-second',
        capturedFrom: 'replay',
      }),
    ]);
    expect(await h.conversationStore.listBindings(copy2.turnId)).toEqual([]);

    await h.inject({ kind: 'session.delete', clientReqId: 'del', sessionId: h.sessionId });
    expect(await texts()).toEqual(['copied earlier', 'copied first', 'copied second']);
  });

  it('replays a lost reply with the same forked session instead of forking twice', async () => {
    const h = await startedHarness();
    const [firstTurnId] = await twoCheckpointedTurns(h);
    await fork(h, 'f1', firstTurnId, 2);
    await vi.waitFor(() => forkedSessionId(h.sent, 'f1'));

    await fork(h, 'f1-again', firstTurnId, 2, { operationId: 'op-f1' });
    await vi.waitFor(() => forkedSessionId(h.sent, 'f1-again'));

    expect(forkedSessionId(h.sent, 'f1-again')).toBe(forkedSessionId(h.sent, 'f1'));
    expect(await h.store.load()).toHaveLength(2);
    expect(forks(h.adapters)).toHaveLength(1);
  });

  it('refuses typed before any provider work: unknown ids, an unfinished turn, a stale revision, a busy source', async () => {
    const h = await startedHarness();
    const [firstTurnId] = await twoCheckpointedTurns(h);

    await fork(h, 'unknown-session', firstTurnId, 2, {
      sourceSessionId: SessionIdSchema.parse('sess-nope'),
    });
    expect(failure(h.sent, 'unknown-session').code).toBe('not_found');
    await fork(h, 'unknown-turn', TurnIdSchema.parse('turn-nope'), 2);
    expect(failure(h.sent, 'unknown-turn').code).toBe('not_found');
    await fork(h, 'stale', firstTurnId, 1);
    expect(failure(h.sent, 'stale')).toMatchObject({
      code: 'conflict',
      message: 'The conversation graph has moved',
    });

    // A running third turn: the source is busy, and the turn itself has not completed.
    await submitPrompt(h, 's3', 'third');
    const thirdTurnId = submittedTurnId(h.sent, 's3');
    h.adapter.emit({ type: 'status', status: 'running' });
    await fork(h, 'busy', firstTurnId, 3);
    expect(failure(h.sent, 'busy').code).toBe('busy');
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();
    // The third turn settled without a checkpoint: completed, but unforkable at its own cut.
    await fork(h, 'no-checkpoint', thirdTurnId, 3);
    expect(failure(h.sent, 'no-checkpoint')).toMatchObject({
      code: 'unsupported',
      message: 'This turn has no provider checkpoint to fork from',
    });

    // The operation id of another session's fork is a client defect, never a replay.
    await fork(h, 'f-ok', firstTurnId, 3);
    await vi.waitFor(() => forkedSessionId(h.sent, 'f-ok'));
    const childId = forkedSessionId(h.sent, 'f-ok');
    const [copy] = await h.conversationStore.listTurns(childId);
    await fork(h, 'foreign', copy.turnId, 0, { sourceSessionId: childId, operationId: 'op-f-ok' });
    expect(failure(h.sent, 'foreign').code).toBe('invalid_request');

    expect(await h.store.load()).toHaveLength(2);
    expect(await h.conversationStore.listOpenOperations()).toEqual([]);
  });

  it('refuses a harness that cannot fork after a turn and one whose turn was never completed', async () => {
    const h = await startedHarness(() => new LegacyBranchOnlyAdapter());
    const [firstTurnId] = await twoCheckpointedTurns(h);

    await fork(h, 'legacy', firstTurnId, 2);

    expect(failure(h.sent, 'legacy')).toMatchObject({
      code: 'unsupported',
      message: 'claude-code: forking a session is not supported',
    });
    expect(forks(h.adapters)).toHaveLength(0);
    expect(await h.store.load()).toHaveLength(1);
  });

  it('a provider refusal leaves no child behind, replays the failure, and frees the source', async () => {
    const h = await startedHarness(() => {
      const adapter = new ForkingAdapter();
      adapter.failFork = new HistoryCheckpointInvalidError(
        'claude-code: checkpoint cp-1 is no longer in transcript native-1',
      );
      return adapter;
    });
    const [firstTurnId] = await twoCheckpointedTurns(h);

    await fork(h, 'f1', firstTurnId, 2);
    await vi.waitFor(() => failure(h.sent, 'f1'));

    expect(failure(h.sent, 'f1')).toMatchObject({
      code: 'unsupported',
      message: 'The provider no longer honours this fork checkpoint',
    });
    expect(await h.store.load()).toHaveLength(1);
    expect(await listed(h)).toHaveLength(1);
    // The child adapter that refused was torn down; nothing forked.
    expect(h.adapters.some((adapter) => adapter !== h.adapter && adapter.stopped)).toBe(true);
    expect(forks(h.adapters)).toHaveLength(0);
    expect(await h.conversationStore.getOperation(OperationIdSchema.parse('op-f1'))).toMatchObject({
      state: 'failed',
      error: { code: 'unsupported' },
    });
    // A retry replays the stored failure verbatim; the source is not busy.
    await fork(h, 'f1-again', firstTurnId, 2, { operationId: 'op-f1' });
    expect(failure(h.sent, 'f1-again').code).toBe('unsupported');
    await submitPrompt(h, 's3', 'third');
    await vi.waitFor(() => submittedTurnId(h.sent, 's3'));
  });

  it('deleting the source keeps the child, its copied lineage, and the shared prompts', async () => {
    const h = await startedHarness();
    const [firstTurnId] = await twoCheckpointedTurns(h);
    await fork(h, 'f1', firstTurnId, 2);
    await vi.waitFor(() => forkedSessionId(h.sent, 'f1'));
    const childId = forkedSessionId(h.sent, 'f1');
    const [copy] = await h.conversationStore.listTurns(childId);

    await h.inject({ kind: 'session.delete', clientReqId: 'del', sessionId: h.sessionId });

    expect(h.sent).toContainEqual({ kind: 'request.succeeded', replyTo: 'del' });
    expect((await h.store.load()).map((record) => record.sessionId)).toEqual([childId]);
    expect(await h.conversationStore.listTurns(childId)).toEqual([copy]);
    const promptId = copy.input.type === 'prompt' ? copy.input.promptId : null;
    expect(promptId).not.toBeNull();
    expect(await h.conversationStore.getPrompt(nullthrow(promptId))).toBeDefined();
    expect(await readUserTexts(h, childId)).toEqual(['first']);
  });

  it('re-binds the copied prefix from an aligned cold read of the child history, else not at all', async () => {
    const aligned: Corpora = {
      [CHILD_HISTORY]: [
        cursorRow('c1', 'first', 'child-before-first'),
        cursorRow('c2', 'second', 'child-before-second'),
      ],
    };
    const h = await startedHarness(() => new ForkingAdapter(aligned));
    const [, secondTurnId] = await twoCheckpointedTurns(h);
    await fork(h, 'f1', secondTurnId, 2);
    await vi.waitFor(() => forkedSessionId(h.sent, 'f1'));
    const childId = forkedSessionId(h.sent, 'f1');
    const [copy1, copy2] = await h.conversationStore.listTurns(childId);
    expect(copy2.parentTurnId).toBe(copy1.turnId);
    expect(await h.conversationStore.listBindings(copy1.turnId)).toEqual([]);

    expect(await readUserTexts(h, childId)).toEqual(['first', 'second']);

    expect(await h.conversationStore.listBindings(copy1.turnId)).toEqual([
      {
        turnId: copy1.turnId,
        runId: copy1.runId,
        historyId: CHILD_HISTORY,
        checkpoint: 'child-before-second',
        capturedFrom: 'replay',
      },
    ]);
    expect(await h.conversationStore.listBindings(copy2.turnId)).toEqual([]);
    // Editing the copied second turn forks the child history at the re-derived cut.
    await submitPrompt(h, 'edit', 'second, edited', childId, {
      parentTurnId: copy1.turnId,
      expectedGraphRevision: 0,
    });
    await vi.waitFor(() => submittedTurnId(h.sent, 'edit'));
    const editor = nullthrow(forks(h.adapters).at(-1));
    expect(editor.branchedFrom).toEqual({
      historyId: CHILD_HISTORY,
      cursor: 'child-before-second',
    });
  });

  it('renders the copied prefix from the source history while the source exists, then from the copy', async () => {
    // The provider's copy carries the same rows re-stamped at the cut (claude), so its `ts` and,
    // here, its text differ from the source's original rows.
    const corpora: Corpora = {
      [SOURCE_HISTORY]: [
        cursorRow('s1', 'first', 'before-first'),
        assistantRow('sa1', 'original answer', 1000),
        cursorRow('s2', 'second', 'before-second'),
        assistantRow('sa2', 'second answer', 2000),
      ],
      [CHILD_HISTORY]: [
        cursorRow('c1', 'first', 'child-before-first'),
        assistantRow('ca1', 'copied answer', 9000),
      ],
    };
    const h = await startedHarness(() => new ForkingAdapter(corpora));
    const [firstTurnId] = await twoCheckpointedTurns(h);
    await fork(h, 'f1', firstTurnId, 2);
    await vi.waitFor(() => forkedSessionId(h.sent, 'f1'));
    const childId = forkedSessionId(h.sent, 'f1');

    expect(await readAssistantRows(h, childId)).toEqual([{ ts: 1000, text: 'original answer' }]);
    // The copy is still attributed for its bindings: the re-binding gate saw one aligned row.
    const [copy] = await h.conversationStore.listTurns(childId);
    expect(copy.turnId).not.toBe(firstTurnId);

    // A source mid-delete (turns purged, record still registered) has no lineage to read.
    await h.conversationStore.deleteSession(h.sessionId);
    expect(await readAssistantRows(h, childId)).toEqual([{ ts: 9000, text: 'copied answer' }]);
    await h.inject({ kind: 'session.delete', clientReqId: 'del', sessionId: h.sessionId });
    expect(await readAssistantRows(h, childId)).toEqual([{ ts: 9000, text: 'copied answer' }]);
  });

  it.each([
    ['a position mismatch', [cursorRow('c1', 'first', 'a'), cursorRow('c2', 'not second', 'b')]],
    ['a row count mismatch', [cursorRow('c1', 'first', 'a')]],
  ])('leaves every copied binding absent on %s', async (_label, rows) => {
    const h = await startedHarness(() => new ForkingAdapter({ [CHILD_HISTORY]: rows }));
    const [, secondTurnId] = await twoCheckpointedTurns(h);
    await fork(h, 'f1', secondTurnId, 2);
    await vi.waitFor(() => forkedSessionId(h.sent, 'f1'));
    const childId = forkedSessionId(h.sent, 'f1');
    const [copy1, copy2] = await h.conversationStore.listTurns(childId);

    expect(await readUserTexts(h, childId)).toEqual(['first', 'second']);

    expect(await h.conversationStore.listBindings(copy1.turnId)).toEqual([]);
    expect(await h.conversationStore.listBindings(copy2.turnId)).toEqual([]);
    await submitPrompt(h, 'edit', 'second, edited', childId, {
      parentTurnId: copy1.turnId,
      expectedGraphRevision: 0,
    });
    await vi.waitFor(() => failure(h.sent, 'edit'));
    expect(failure(h.sent, 'edit')).toMatchObject({
      code: 'unsupported',
      message: 'This turn has no provider checkpoint to fork from',
    });
  });

  it('an engine stop mid-fork resolves the operation and persists no child', async () => {
    const h = await startedHarness(() => new GatedForkAdapter());
    const [firstTurnId] = await twoCheckpointedTurns(h);

    await fork(h, 'f1', firstTurnId, 2);
    await vi.waitFor(() => {
      expect(forks(h.adapters)).toHaveLength(1);
    });
    await h.engine.stop();

    expect(await h.store.load()).toHaveLength(1);
    expect(await h.conversationStore.getOperation(OperationIdSchema.parse('op-f1'))).toMatchObject({
      state: 'failed',
      error: { code: 'cancelled' },
    });
  });

  it('boot recovery fails an open fork operation the previous daemon left behind', async () => {
    const store = new InMemorySessionStore();
    const conversationStore = new InMemoryConversationStore();
    const sessionId = SessionIdSchema.parse('sess-source');
    await store.save({
      sessionId,
      kind: 'claude-code',
      cwd: '/repo',
      origin: { type: 'created' },
      createdAt: 1,
      updatedAt: 1,
      runs: [{ runId: 'run-1' as never, startedAt: 1 }],
      graphRevision: 0,
      eventEpoch: 0,
    });
    await conversationStore.persistOperation({
      operationId: OperationIdSchema.parse('op-fork'),
      sessionId,
      kind: 'session.fork',
      state: 'open',
      createdAt: 1,
    });
    const h = harness(store, undefined, undefined, undefined, undefined, undefined, {
      conversationStore,
    });
    await h.engine.start();

    expect(await conversationStore.getOperation(OperationIdSchema.parse('op-fork'))).toMatchObject({
      state: 'failed',
      error: {
        code: 'operation_failed',
        message: 'The daemon restarted before the fork completed',
      },
    });
    expect(await conversationStore.listOpenOperations()).toEqual([]);
  });
});
