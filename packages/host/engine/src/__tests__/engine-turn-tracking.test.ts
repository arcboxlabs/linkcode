import type { AgentInput } from '@linkcode/schema';
import { OperationIdSchema, RunIdSchema, TurnIdSchema, textBlock } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { describe, expect, it } from 'vitest';
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
    const prompt = await h.conversationStore.getPrompt(turn.input.promptId);
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

  it('refuses a legacy turn input while an operation is open', async () => {
    const h = await startedHarness();
    await h.conversationStore.persistTurnIntent({
      turn: {
        turnId: TurnIdSchema.parse('turn-open'),
        sessionId: h.sessionId,
        parentTurnId: null,
        siblingOrdinal: 1,
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
