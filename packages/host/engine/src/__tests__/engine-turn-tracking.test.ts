import { asHistoryId } from '@linkcode/agent-adapter';
import type {
  AgentHistoryCapabilities,
  AgentInput,
  ValidatedWireMessage,
  WirePayload,
} from '@linkcode/schema';
import {
  MessageIdSchema,
  OperationIdSchema,
  RunIdSchema,
  SessionIdSchema,
  TurnIdSchema,
  textBlock,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { Effect } from 'effect';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryConversationStore } from '../conversation/conversation-store';
import { ConversationTurnService } from '../conversation/turn-service';
import { SessionRecordRegistry } from '../session/session-record-registry';
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

class HangingSendAdapter extends FakeAdapter {
  override send(input: AgentInput): Promise<void> {
    this.sentInputs.push(input);
    return new Promise<void>(noop);
  }
}

class BranchingAdapter extends FakeAdapter {
  override readonly historyCapabilities: AgentHistoryCapabilities = {
    list: false,
    read: true,
    resume: true,
    branch: true,
  };

  branchHistory(): Promise<void> {
    this.emit({ type: 'session-ref', historyId: asHistoryId('native-child') });
    return Promise.resolve();
  }
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
    {
      conversationStore,
    },
  );
  await h.engine.start();
  await h.inject({
    kind: 'session.start',
    clientReqId: 'r1',
    opts: { kind: 'claude-code', cwd: '/repo' },
  });
  return {
    ...h,
    conversationStore,
    sessionId: startedId(h.sent, 'r1'),
    adapter: nullthrow(h.adapters[0]),
  };
}

describe('legacy input turn tracking', () => {
  it('persists a turn for a legacy prompt and completes it on idle', async () => {
    const h = await startedHarness();

    await h.inject({
      kind: 'agent.input',
      clientReqId: 'input',
      sessionId: h.sessionId,
      input: { type: 'prompt', content: [textBlock('hello')] },
    });

    const [turn] = await h.conversationStore.listTurns(h.sessionId);
    expect(turn).toMatchObject({
      parentTurnId: null,
      siblingOrdinal: 1,
      state: 'running',
      input: { type: 'prompt' },
    });
    if (turn.input.type !== 'prompt') throw new Error('expected a prompt turn');
    const prompt = await h.conversationStore.getPrompt(nullthrow(turn.input.promptId));
    expect(prompt?.blocks).toEqual([{ type: 'text', text: 'hello' }]);
    expect(await h.conversationStore.listOpenOperations(h.sessionId)).toHaveLength(0);
    const [record] = await h.store.load();
    expect(record.activeLeafTurnId).toBe(turn.turnId);
    expect(record.graphRevision).toBe(1);
    expect(h.sent).toContainEqual(
      expect.objectContaining({
        kind: 'conversation.graph.changed',
        sessionId: h.sessionId,
        graphRevision: 1,
        activeLeafTurnId: turn.turnId,
      }),
    );

    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();
    const [settled] = await h.conversationStore.listTurns(h.sessionId);
    expect(settled.state).toBe('completed');
  });

  it('flips a cancelled turn to cancelled on the stop frame', async () => {
    const h = await startedHarness();
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'input',
      sessionId: h.sessionId,
      input: { type: 'prompt', content: [textBlock('work')] },
    });

    h.adapter.emit({ type: 'stop', stopReason: 'cancelled' });
    await settleEngineTasks();

    const [turn] = await h.conversationStore.listTurns(h.sessionId);
    expect(turn.state).toBe('cancelled');
  });

  it('marks an error-terminated turn failed on the stop-less idle settle', async () => {
    const h = await startedHarness();
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'input',
      sessionId: h.sessionId,
      input: { type: 'prompt', content: [textBlock('work')] },
    });

    h.adapter.emit({ type: 'error', message: 'provider exploded', recoverable: true });
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();

    const [turn] = await h.conversationStore.listTurns(h.sessionId);
    expect(turn.state).toBe('failed');
  });

  it('records command and shell inputs as turns and closes an unsettled predecessor', async () => {
    const h = await startedHarness();
    h.adapter.emit({
      type: 'capabilities-update',
      capabilities: { slashCommands: true, shellCommand: true },
    });
    h.adapter.emit({ type: 'available-commands-update', commands: [{ name: 'review' }] });

    await h.inject({
      kind: 'agent.input',
      clientReqId: 'r-cmd',
      sessionId: h.sessionId,
      input: { type: 'command', name: 'review' },
    });
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'r-sh',
      sessionId: h.sessionId,
      input: { type: 'shell-command', command: 'git status' },
    });
    await settleEngineTasks();

    const turns = await h.conversationStore.listTurns(h.sessionId);
    expect(turns).toHaveLength(2);
    const command = turns.find((turn) => turn.input.type === 'command');
    const shell = turns.find((turn) => turn.input.type === 'shell-command');
    expect(command).toMatchObject({ parentTurnId: null, state: 'completed' });
    expect(shell).toMatchObject({ parentTurnId: command?.turnId, state: 'running' });
  });

  it('stores the failure when the adapter rejects a turn input', async () => {
    const h = await startedHarness(() => new RejectingTurnAdapter());

    await h.inject({
      kind: 'agent.input',
      clientReqId: 'input',
      sessionId: h.sessionId,
      input: { type: 'prompt', content: [textBlock('hello')] },
    });

    const [turn] = await h.conversationStore.listTurns(h.sessionId);
    expect(turn.state).toBe('failed');
    const operations = await h.conversationStore.listOpenOperations(h.sessionId);
    expect(operations).toHaveLength(0);
    const [record] = await h.store.load();
    expect(record.activeLeafTurnId).toBeUndefined();
    expect(record.graphRevision).toBe(0);
  });

  it('resolves the persisted turn when the session stops while its dispatch hangs', async () => {
    const h = await startedHarness(() => new HangingSendAdapter());
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'input',
      sessionId: h.sessionId,
      input: { type: 'prompt', content: [textBlock('work')] },
    });
    // The intent is persisted and the adapter never acknowledges; stopping interrupts the dispatch.
    expect(await h.conversationStore.listOpenOperations(h.sessionId)).toHaveLength(1);

    await h.inject({ kind: 'session.stop', clientReqId: 'stop', sessionId: h.sessionId });

    await vi.waitFor(async () => {
      expect(await h.conversationStore.listOpenOperations(h.sessionId)).toHaveLength(0);
    });
    const [turn] = await h.conversationStore.listTurns(h.sessionId);
    expect(turn.state).toBe('failed');
  });

  it('closes an unsettled predecessor as failed when its run saw an adapter error', async () => {
    const h = await startedHarness();
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'first',
      sessionId: h.sessionId,
      input: { type: 'prompt', content: [textBlock('one')] },
    });
    h.adapter.emit({ type: 'error', message: 'provider exploded', recoverable: true });
    await settleEngineTasks();

    // No idle/stop settle arrived; admitting the next turn closes the predecessor out honestly.
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'second',
      sessionId: h.sessionId,
      input: { type: 'prompt', content: [textBlock('two')] },
    });
    await settleEngineTasks();

    const turns = await h.conversationStore.listTurns(h.sessionId);
    expect(turns.map((turn) => turn.state)).toEqual(['failed', 'running']);
  });

  it('cancels the running turn when the session is stopped mid-turn', async () => {
    const h = await startedHarness();
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'input',
      sessionId: h.sessionId,
      input: { type: 'prompt', content: [textBlock('work')] },
    });
    h.adapter.emit({ type: 'status', status: 'running' });

    await h.inject({ kind: 'session.stop', clientReqId: 'stop', sessionId: h.sessionId });
    await settleEngineTasks();

    const [turn] = await h.conversationStore.listTurns(h.sessionId);
    expect(turn.state).toBe('cancelled');
  });

  it('records a legacy rewrite as a sibling turn and moves the active leaf', async () => {
    const h = await startedHarness(() => new BranchingAdapter());
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'original',
      sessionId: h.sessionId,
      input: { type: 'prompt', content: [textBlock('original prompt')] },
    });
    h.adapter.emit({ type: 'session-ref', historyId: asHistoryId('native-source') });
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();

    await h.inject({
      kind: 'history.branch',
      clientReqId: 'rewrite',
      sourceSessionId: h.sessionId,
      sourceMessageId: MessageIdSchema.parse('source-message'),
      branchCursor: 'opaque-cursor',
      content: [textBlock('edited prompt')],
    });
    await vi.waitFor(() =>
      expect(h.sent).toContainEqual(
        expect.objectContaining({ kind: 'session.started', replyTo: 'rewrite' }),
      ),
    );

    const turns = await h.conversationStore.listTurns(h.sessionId);
    expect(turns).toHaveLength(2);
    const original = nullthrow(turns.find((turn) => turn.siblingOrdinal === 1));
    const replacement = nullthrow(turns.find((turn) => turn.siblingOrdinal === 2));
    expect(original.state).toBe('completed');
    // The replacement is a sibling under the rewritten turn's parent, never a child of the leaf.
    expect(replacement).toMatchObject({ parentTurnId: null, state: 'running' });
    if (replacement.input.type !== 'prompt') throw new Error('expected a prompt turn');
    const prompt = await h.conversationStore.getPrompt(nullthrow(replacement.input.promptId));
    expect(prompt?.blocks).toEqual([{ type: 'text', text: 'edited prompt' }]);
    const [record] = await h.store.load();
    expect(record.activeLeafTurnId).toBe(replacement.turnId);
    expect(record.runs.at(-1)?.runId).toBe(replacement.runId);
  });

  it('resolves open operations and dead turns at boot, and replays the stored error', async () => {
    const conversationStore = new InMemoryConversationStore();
    const sessionId = SessionIdSchema.parse('sess-recover');
    await conversationStore.persistTurnIntent({
      turn: {
        turnId: TurnIdSchema.parse('turn-preparing'),
        sessionId,
        parentTurnId: null,
        input: { type: 'shell-command', command: 'sleep 1' },
        runId: RunIdSchema.parse('run-dead'),
        state: 'preparing',
        createdAt: Date.now(),
      },
      operation: {
        operationId: OperationIdSchema.parse('op-interrupted'),
        sessionId,
        kind: 'turn.submit',
        state: 'open',
        createdAt: Date.now(),
      },
    });
    await conversationStore.saveTurn({
      turnId: TurnIdSchema.parse('turn-running'),
      sessionId,
      parentTurnId: null,
      siblingOrdinal: 2,
      input: { type: 'shell-command', command: 'sleep 2' },
      runId: RunIdSchema.parse('run-dead'),
      state: 'running',
      createdAt: Date.now(),
    });

    const h = harness(
      new InMemorySessionStore(),
      () => new FakeAdapter(),
      undefined,
      undefined,
      undefined,
      undefined,
      { conversationStore },
    );
    await h.engine.start();

    const turns = await conversationStore.listTurns(sessionId);
    expect(turns.map((turn) => turn.state)).toEqual(['failed', 'failed']);
    expect(await conversationStore.listOpenOperations()).toHaveLength(0);

    // Replay happens before any validation, so even an unknown session replays the result.
    await h.inject({
      kind: 'turn.submit',
      clientReqId: 'replayed',
      sessionId,
      operationId: OperationIdSchema.parse('op-interrupted'),
      input: { type: 'shell-command', command: 'sleep 1' },
    });
    expect(h.sent).toContainEqual(
      expect.objectContaining({
        kind: 'request.failed',
        replyTo: 'replayed',
        code: 'operation_failed',
        message: 'The daemon restarted before the turn was dispatched',
      }),
    );
  });

  it('refuses a legacy turn input while an operation is open', async () => {
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

    await h.inject({
      kind: 'agent.input',
      clientReqId: 'input',
      sessionId: h.sessionId,
      input: { type: 'prompt', content: [textBlock('hello')] },
    });

    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'input',
      code: 'busy',
      message: `Session is busy: ${h.sessionId}`,
      reportedInConversation: true,
    });
    expect(h.adapter.sentInputs).toHaveLength(0);
  });
});

describe('commitRunning idempotence', () => {
  const sessionId = SessionIdSchema.parse('sess-commit');

  async function turnServiceFixture() {
    const sent: WirePayload[] = [];
    const transport: Transport = {
      connect: () => Promise.resolve(),
      send(message: ValidatedWireMessage) {
        sent.push(message.payload);
      },
      onMessage: () => noop,
      onClose: () => noop,
      close: noop,
    };
    const registry = new SessionRecordRegistry(new InMemorySessionStore(), noop);
    await Effect.runPromise(
      registry.start((effect) => {
        void Effect.runPromise(effect);
      }),
    );
    registry.register({
      sessionId,
      kind: 'claude-code',
      cwd: '/repo',
      origin: { type: 'created' },
      createdAt: 1,
      updatedAt: 1,
      runs: [],
      graphRevision: 0,
      eventEpoch: 0,
    });
    const store = new InMemoryConversationStore();
    const turns = new ConversationTurnService(store, registry, transport, (effect) => {
      void Effect.runPromise(effect);
    });
    const intent = await Effect.runPromise(
      turns.persistIntent({
        sessionId,
        operationId: OperationIdSchema.parse('op-1'),
        runId: RunIdSchema.parse('run-1'),
        parentTurnId: null,
        input: { type: 'shell-command', command: 'git status' },
      }),
    );
    return { sent, registry, store, turns, intent };
  }

  it('a second commit for a resolved operation is a no-op: no error, no second graph move', async () => {
    const { sent, registry, store, turns, intent } = await turnServiceFixture();

    await Effect.runPromise(turns.commitRunning(intent));
    await Effect.runPromise(turns.commitRunning(intent));

    expect((await store.getOperation(OperationIdSchema.parse('op-1')))?.state).toBe('succeeded');
    expect(registry.get(sessionId)?.graphRevision).toBe(1);
    expect(sent.filter((payload) => payload.kind === 'conversation.graph.changed')).toHaveLength(1);
  });

  it('a commit that lost the resolve race runs no side effects at all', async () => {
    const { sent, registry, store, turns, intent } = await turnServiceFixture();
    await Effect.runPromise(turns.resolveFailed(intent, { code: 'timeout', message: 'too slow' }));

    await Effect.runPromise(turns.commitRunning(intent));

    const operation = await store.getOperation(OperationIdSchema.parse('op-1'));
    expect(operation).toMatchObject({ state: 'failed', error: { code: 'timeout' } });
    expect(registry.get(sessionId)?.graphRevision).toBe(0);
    expect(sent.filter((payload) => payload.kind === 'conversation.graph.changed')).toHaveLength(0);
    // Nor tracking: a settle for this run must find nothing to flip.
    turns.settleStop(sessionId, RunIdSchema.parse('run-1'), 'end_turn');
    await settleEngineTasks();
    expect((await store.listTurns(sessionId))[0].state).toBe('failed');
  });

  it('a resolveFailed that lost the race returns the stored terminal result', async () => {
    const { store, turns, intent } = await turnServiceFixture();
    await Effect.runPromise(turns.commitRunning(intent));

    const result = await Effect.runPromise(
      turns.resolveFailed(intent, { code: 'busy', message: 'late loser' }),
    );

    const stored = await store.getOperation(OperationIdSchema.parse('op-1'));
    expect(result).toEqual(stored);
    expect(result.state).toBe('succeeded');
  });
});
