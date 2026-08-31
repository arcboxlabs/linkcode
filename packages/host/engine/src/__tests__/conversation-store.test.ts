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
import { InMemoryConversationStore } from '../conversation/conversation-store';

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
    await store.persistTurnIntent(intent);

    expect(await store.listTurns(SessionIdSchema.parse('s-1'))).toEqual([intent.turn]);
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

  it('upserts bindings by (turnId, historyId)', async () => {
    const store = new InMemoryConversationStore();
    const binding = ProviderTurnBindingSchema.parse({
      turnId: 't-1',
      runId: 'run-1',
      historyId: 'native-1',
      checkpoint: '{"uuid":"a"}',
      capturedFrom: 'live',
    });
    await store.saveBinding(binding);
    const recaptured = { ...binding, checkpoint: '{"uuid":"b"}', capturedFrom: 'replay' as const };
    await store.saveBinding(recaptured);
    const other = { ...binding, historyId: 'native-2' };
    await store.saveBinding(other);

    expect(await store.listBindings(TurnIdSchema.parse('t-1'))).toEqual([recaptured, other]);
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
    await store.persistTurnIntent({
      turn: turn({ turnId: 't-own', sessionId: 's-parent', promptId: 'p-own' }),
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
});
