import type { ConversationOperation, ConversationTurn, PromptRecord } from '@linkcode/schema';
import {
  ConversationOperationSchema,
  ConversationTurnSchema,
  OperationIdSchema,
  PromptIdSchema,
  PromptRecordSchema,
  ProviderTurnBindingSchema,
  SessionIdSchema,
  TurnIdSchema,
} from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import {
  ConversationSessionBusyError,
  InMemoryConversationStore,
} from '../conversation/conversation-store';

function turn(value: {
  turnId: string;
  sessionId: string;
  promptId?: string;
  parentTurnId?: string | null;
  state?: ConversationTurn['state'];
}): ConversationTurn {
  return ConversationTurnSchema.parse({
    turnId: value.turnId,
    sessionId: value.sessionId,
    parentTurnId: value.parentTurnId ?? null,
    siblingOrdinal: 1,
    input: value.promptId
      ? { type: 'prompt', promptId: value.promptId }
      : { type: 'shell-command', command: 'git status' },
    runId: 'run-1',
    state: value.state ?? 'preparing',
    createdAt: 1,
  });
}

function prompt(promptId: string): PromptRecord {
  return PromptRecordSchema.parse({
    promptId,
    blocks: [{ type: 'text', text: 'hello' }],
    contextAttachmentIds: [],
    createdAt: 1,
  });
}

function openOperation(operationId: string, sessionId: string): ConversationOperation {
  return ConversationOperationSchema.parse({
    operationId,
    sessionId,
    kind: 'turn.submit',
    state: 'open',
    createdAt: 1,
  });
}

describe('InMemoryConversationStore', () => {
  it('persists a turn intent as one unit and resolves its operation', async () => {
    const store = new InMemoryConversationStore();
    const intent = {
      turn: turn({ turnId: 't-1', sessionId: 's-1', promptId: 'p-1' }),
      prompt: prompt('p-1'),
      operation: openOperation('op-1', 's-1'),
    };
    const persisted = await store.persistTurnIntent(intent);

    expect(persisted).toEqual({ ...intent.turn, siblingOrdinal: 1 });
    expect(await store.listTurns(SessionIdSchema.parse('s-1'))).toEqual([persisted]);
    expect(await store.getPrompt(PromptIdSchema.parse('p-1'))).toEqual(intent.prompt);
    expect(await store.listOpenOperations(SessionIdSchema.parse('s-1'))).toEqual([
      intent.operation,
    ]);

    const resolved = ConversationOperationSchema.parse({
      operationId: 'op-1',
      sessionId: 's-1',
      kind: 'turn.submit',
      state: 'succeeded',
      turnId: 't-1',
      createdAt: 1,
      resolvedAt: 2,
    });
    const running = { ...intent.turn, state: 'running' as const };
    await store.resolveOperation(resolved, running);

    expect(await store.getOperation(OperationIdSchema.parse('op-1'))).toEqual(resolved);
    expect(await store.listOpenOperations()).toEqual([]);
    expect(await store.listTurns(SessionIdSchema.parse('s-1'))).toEqual([running]);
  });

  it('re-captures replay bindings, lets a live one replace them, and never overwrites a live one', async () => {
    const store = new InMemoryConversationStore();
    const live = ProviderTurnBindingSchema.parse({
      turnId: 't-1',
      runId: 'run-1',
      historyId: 'native-1',
      checkpoint: '{"uuid":"a"}',
      capturedFrom: 'live',
    });
    // A cold read can land first; the live capture that follows replaces it.
    await store.saveBinding({ ...live, checkpoint: '{"uuid":"early"}', capturedFrom: 'replay' });
    await store.saveBinding(live);
    await store.saveBinding({ ...live, checkpoint: '{"uuid":"b"}', capturedFrom: 'replay' });
    await store.saveBinding({ ...live, checkpoint: '{"uuid":"c"}' });
    const replay = { ...live, historyId: 'native-2', capturedFrom: 'replay' as const };
    await store.saveBinding(replay);
    const recaptured = { ...replay, checkpoint: '{"uuid":"d"}' };
    await store.saveBinding(recaptured);

    expect(await store.listBindings(TurnIdSchema.parse('t-1'))).toEqual([live, recaptured]);
  });

  it('deleteSession keeps prompts still referenced by another session and drops the rest', async () => {
    const store = new InMemoryConversationStore();
    const shared = prompt('p-shared');
    const own = prompt('p-own');
    await store.persistTurnIntent({
      turn: turn({ turnId: 't-parent', sessionId: 's-parent', promptId: 'p-shared' }),
      prompt: shared,
      operation: openOperation('op-1', 's-parent'),
    });
    await store.resolveOperation(
      ConversationOperationSchema.parse({
        operationId: 'op-1',
        sessionId: 's-parent',
        kind: 'turn.submit',
        state: 'succeeded',
        turnId: 't-parent',
        createdAt: 1,
        resolvedAt: 2,
      }),
    );
    await store.persistTurnIntent({
      turn: turn({
        turnId: 't-own',
        sessionId: 's-parent',
        promptId: 'p-own',
        parentTurnId: 't-parent',
      }),
      prompt: own,
      operation: openOperation('op-2', 's-parent'),
    });
    // The fork references the shared prompt from its own copied turn row.
    await store.saveTurn(turn({ turnId: 't-child', sessionId: 's-fork', promptId: 'p-shared' }));
    await store.saveBinding(
      ProviderTurnBindingSchema.parse({
        turnId: 't-parent',
        runId: 'run-1',
        historyId: 'native-1',
        checkpoint: 'c',
        capturedFrom: 'live',
      }),
    );

    await store.deleteSession(SessionIdSchema.parse('s-parent'));

    expect(await store.listTurns(SessionIdSchema.parse('s-parent'))).toEqual([]);
    expect(await store.listBindings(TurnIdSchema.parse('t-parent'))).toEqual([]);
    expect(await store.listOpenOperations()).toEqual([]);
    expect(await store.getPrompt(PromptIdSchema.parse('p-own'))).toBeUndefined();
    expect(await store.getPrompt(PromptIdSchema.parse('p-shared'))).toEqual(shared);
  });

  it('refuses a second intent while the session has an open operation', async () => {
    const store = new InMemoryConversationStore();
    await store.persistTurnIntent({
      turn: turn({ turnId: 't-1', sessionId: 's-1' }),
      operation: openOperation('op-1', 's-1'),
    });

    await expect(
      store.persistTurnIntent({
        turn: turn({ turnId: 't-2', sessionId: 's-1' }),
        operation: openOperation('op-2', 's-1'),
      }),
    ).rejects.toBeInstanceOf(ConversationSessionBusyError);
    expect(await store.listTurns(SessionIdSchema.parse('s-1'))).toHaveLength(1);

    // Another session is not gated by this one's open operation.
    await store.persistTurnIntent({
      turn: turn({ turnId: 't-other', sessionId: 's-2' }),
      operation: openOperation('op-other', 's-2'),
    });
  });

  it('a same-tick persist race yields one open operation and one busy rejection', async () => {
    const store = new InMemoryConversationStore();

    const results = await Promise.allSettled([
      store.persistTurnIntent({
        turn: turn({ turnId: 't-1', sessionId: 's-1' }),
        operation: openOperation('op-1', 's-1'),
      }),
      store.persistTurnIntent({
        turn: turn({ turnId: 't-2', sessionId: 's-1' }),
        operation: openOperation('op-2', 's-1'),
      }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(ConversationSessionBusyError);
    expect(await store.listOpenOperations(SessionIdSchema.parse('s-1'))).toHaveLength(1);
    expect(await store.listTurns(SessionIdSchema.parse('s-1'))).toHaveLength(1);
  });

  it('assigns sibling ordinals itself and refuses a replayed operation id', async () => {
    const store = new InMemoryConversationStore();
    const first = await store.persistTurnIntent({
      turn: turn({ turnId: 't-1', sessionId: 's-1' }),
      operation: openOperation('op-1', 's-1'),
    });
    await store.resolveOperation({
      ...openOperation('op-1', 's-1'),
      state: 'failed',
      error: { code: 'busy', message: 'nope' },
      resolvedAt: 2,
    });
    const second = await store.persistTurnIntent({
      turn: turn({ turnId: 't-2', sessionId: 's-1' }),
      operation: openOperation('op-2', 's-1'),
    });
    expect([first.siblingOrdinal, second.siblingOrdinal]).toEqual([1, 2]);

    await store.resolveOperation({
      ...openOperation('op-2', 's-1'),
      state: 'failed',
      error: { code: 'busy', message: 'nope' },
      resolvedAt: 3,
    });
    await expect(
      store.persistTurnIntent({
        turn: turn({ turnId: 't-3', sessionId: 's-1' }),
        operation: openOperation('op-1', 's-1'),
      }),
    ).rejects.toThrow('already persisted');
  });

  it('resolveOperation transitions open rows only — the first terminal result stands', async () => {
    const store = new InMemoryConversationStore();
    const persisted = await store.persistTurnIntent({
      turn: turn({ turnId: 't-1', sessionId: 's-1' }),
      operation: openOperation('op-1', 's-1'),
    });
    const failed = ConversationOperationSchema.parse({
      operationId: 'op-1',
      sessionId: 's-1',
      kind: 'turn.submit',
      state: 'failed',
      error: { code: 'timeout', message: 'too slow' },
      createdAt: 1,
      resolvedAt: 2,
    });
    expect(await store.resolveOperation(failed, { ...persisted, state: 'failed' })).toBe(true);

    // A late success must not overwrite the stored failure or flip the turn.
    expect(
      await store.resolveOperation(
        ConversationOperationSchema.parse({
          operationId: 'op-1',
          sessionId: 's-1',
          kind: 'turn.submit',
          state: 'succeeded',
          turnId: 't-1',
          createdAt: 1,
          resolvedAt: 3,
        }),
        { ...persisted, state: 'running' },
      ),
    ).toBe(false);

    expect(await store.getOperation(OperationIdSchema.parse('op-1'))).toEqual(failed);
    expect(await store.listTurns(SessionIdSchema.parse('s-1'))).toEqual([
      { ...persisted, state: 'failed' },
    ]);
  });
});
