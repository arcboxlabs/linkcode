import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConversationStore } from '@linkcode/engine';
import { ConversationSessionBusyError } from '@linkcode/engine';
import type { ConversationOperation, ConversationTurn, PromptRecord } from '@linkcode/schema';
import {
  ConversationOperationSchema,
  ConversationTurnSchema,
  OperationIdSchema,
  PromptIdSchema,
  PromptRecordSchema,
  ProviderTurnBindingSchema,
  SessionIdSchema,
  SessionRecordSchema,
  TurnIdSchema,
} from '@linkcode/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { createConversationStore } from '../conversation-store';
import type { DaemonDatabase } from '../db/database';
import { openDaemonDatabase } from '../db/database';
import { createSessionStore } from '../session-store';

const temporaryDirectories: string[] = [];
const openDatabases = new Set<DaemonDatabase>();

function openDatabase(path: string): DaemonDatabase {
  const database = openDaemonDatabase(path);
  openDatabases.add(database);
  return database;
}

function closeDatabase(database: DaemonDatabase): void {
  database.close();
  openDatabases.delete(database);
}

afterEach(async () => {
  for (const database of openDatabases) database.close();
  openDatabases.clear();
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function databaseWithSessions(
  ...sessionIds: string[]
): Promise<{ readonly path: string; readonly database: DaemonDatabase }> {
  const directory = await mkdtemp(join(tmpdir(), 'linkcode-conversation-store-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'daemon.db');
  const database = openDatabase(path);
  const sessions = createSessionStore(database.client);
  for (let i = 0, len = sessionIds.length; i < len; i++) {
    await sessions.save(
      SessionRecordSchema.parse({
        sessionId: sessionIds[i],
        kind: 'claude-code',
        cwd: '/repo',
        origin: { type: 'created' },
        createdAt: 1,
        updatedAt: 1,
        runs: [],
      }),
    );
  }
  return { path, database };
}

function turn(value: {
  turnId: string;
  sessionId?: string;
  parentTurnId?: string | null;
  siblingOrdinal?: number;
  input?: unknown;
  runId?: string;
  state?: ConversationTurn['state'];
  createdAt?: number;
}): ConversationTurn {
  return ConversationTurnSchema.parse({
    sessionId: 's-1',
    parentTurnId: null,
    siblingOrdinal: 1,
    input: { type: 'shell-command', command: 'git status' },
    runId: 'run-1',
    state: 'preparing',
    createdAt: 1,
    ...value,
  });
}

function prompt(promptId: string): PromptRecord {
  return PromptRecordSchema.parse({
    promptId,
    blocks: [
      { type: 'text', text: 'compare these' },
      { type: 'attachment_ref', attachmentId: 'att-block' },
    ],
    contextAttachmentIds: ['att-ctx-2', 'att-ctx-1'],
    createdAt: 3,
  });
}

function openOperation(operationId: string, sessionId = 's-1'): ConversationOperation {
  return ConversationOperationSchema.parse({
    operationId,
    sessionId,
    kind: 'turn.submit',
    state: 'open',
    createdAt: 4,
  });
}

async function seedIntent(store: ConversationStore): Promise<void> {
  await store.persistTurnIntent({
    turn: turn({
      turnId: 't-prompted',
      input: { type: 'prompt', promptId: PromptIdSchema.parse('p-1') },
      createdAt: 2,
    }),
    prompt: prompt('p-1'),
    operation: openOperation('op-1'),
  });
}

describe('SQLite conversation store', () => {
  /**
   * Every field must survive save→load through a fresh store instance: a column this table drops
   * is a turn silently changing meaning on the next daemon boot, and the in-memory store cannot
   * catch it (the daemon store trap in apps/daemon/AGENTS.md).
   */
  it('round-trips every turn field, all three input shapes included', async () => {
    const { path, database } = await databaseWithSessions('s-1');
    const migratedTurn = turn({
      turnId: 't-5',
      parentTurnId: TurnIdSchema.parse('t-4'),
      input: { type: 'prompt', promptId: null },
      state: 'completed',
      createdAt: 5,
    });
    const turns = [
      turn({
        turnId: 't-1',
        input: { type: 'prompt', promptId: PromptIdSchema.parse('p-1') },
        state: 'completed',
        createdAt: 1,
      }),
      turn({
        turnId: 't-2',
        parentTurnId: TurnIdSchema.parse('t-1'),
        siblingOrdinal: 2,
        input: { type: 'command', name: 'compact', arguments: '--all' },
        runId: 'run-2',
        state: 'failed',
        createdAt: 2,
      }),
      turn({
        turnId: 't-3',
        parentTurnId: TurnIdSchema.parse('t-1'),
        siblingOrdinal: 3,
        input: { type: 'command', name: 'review' },
        state: 'cancelled',
        createdAt: 3,
      }),
      turn({
        turnId: 't-4',
        parentTurnId: TurnIdSchema.parse('t-2'),
        input: { type: 'shell-command', command: 'pnpm test' },
        state: 'running',
        createdAt: 4,
      }),
      migratedTurn,
    ];
    const store = createConversationStore(database.client);
    await store.persistTurnIntent({
      turn: turns[0],
      prompt: prompt('p-1'),
      operation: openOperation('op-1'),
    });
    await store.resolveOperation({
      ...openOperation('op-1'),
      state: 'succeeded',
      turnId: turns[0].turnId,
      resolvedAt: 9,
    });
    for (let i = 1, len = turns.length - 1; i < len; i++) {
      await store.saveTurn(turns[i]);
    }

    // A migrated prompt turn persists with `promptId: null`; its prompt record is not inserted.
    await store.persistTurnIntent({
      turn: migratedTurn,
      prompt: prompt('p-migrated'),
      operation: openOperation('op-migrated'),
    });

    closeDatabase(database);
    const reopened = createConversationStore(openDatabase(path).client);
    expect(await reopened.listTurns(SessionIdSchema.parse('s-1'))).toEqual(turns);
    expect(await reopened.getPrompt(PromptIdSchema.parse('p-migrated'))).toBeUndefined();
  });

  it('round-trips prompts, preserving block and context order', async () => {
    const { database } = await databaseWithSessions('s-1');
    await seedIntent(createConversationStore(database.client));

    expect(
      await createConversationStore(database.client).getPrompt(PromptIdSchema.parse('p-1')),
    ).toEqual(prompt('p-1'));
  });

  it('round-trips bindings and re-captures by (turn, history)', async () => {
    const { database } = await databaseWithSessions('s-1');
    const store = createConversationStore(database.client);
    await seedIntent(store);
    const live = ProviderTurnBindingSchema.parse({
      turnId: 't-prompted',
      runId: 'run-1',
      historyId: 'native-1',
      checkpoint: '{"uuid":"a"}',
      capturedFrom: 'live',
    });
    await store.saveBinding(live);
    await store.saveBinding({ ...live, historyId: 'native-2', capturedFrom: 'replay' });
    const recaptured = ProviderTurnBindingSchema.parse({
      ...live,
      runId: 'run-9',
      checkpoint: '{"uuid":"b"}',
    });
    await store.saveBinding(recaptured);

    expect(
      await createConversationStore(database.client).listBindings(TurnIdSchema.parse('t-prompted')),
    ).toEqual([recaptured, { ...live, historyId: 'native-2', capturedFrom: 'replay' }]);
  });

  it('round-trips operations through every state', async () => {
    const { path, database } = await databaseWithSessions('s-1');
    const store = createConversationStore(database.client);
    await seedIntent(store);
    expect(await store.getOperation(OperationIdSchema.parse('op-1'))).toEqual(
      openOperation('op-1'),
    );
    expect(await store.listOpenOperations(SessionIdSchema.parse('s-1'))).toEqual([
      openOperation('op-1'),
    ]);

    const succeeded = ConversationOperationSchema.parse({
      operationId: 'op-1',
      sessionId: 's-1',
      kind: 'turn.submit',
      state: 'succeeded',
      turnId: 't-prompted',
      createdAt: 4,
      resolvedAt: 9,
    });
    const running = turn({
      turnId: 't-prompted',
      input: { type: 'prompt', promptId: PromptIdSchema.parse('p-1') },
      state: 'running',
      createdAt: 2,
    });
    await store.resolveOperation(succeeded, running);
    const doomed = await store.persistTurnIntent({
      turn: turn({ turnId: 't-doomed', createdAt: 5 }),
      operation: openOperation('op-2'),
    });
    const failed = ConversationOperationSchema.parse({
      operationId: 'op-2',
      sessionId: 's-1',
      kind: 'turn.submit',
      state: 'failed',
      error: { code: 'busy', message: 'A turn is already running' },
      createdAt: 4,
      resolvedAt: 6,
    });
    await store.resolveOperation(failed, { ...doomed, state: 'failed' });

    closeDatabase(database);
    const reopened = createConversationStore(openDatabase(path).client);
    expect(await reopened.getOperation(OperationIdSchema.parse('op-1'))).toEqual(succeeded);
    expect(await reopened.getOperation(OperationIdSchema.parse('op-2'))).toEqual(failed);
    expect(await reopened.listOpenOperations()).toEqual([]);
    expect(await reopened.listTurns(SessionIdSchema.parse('s-1'))).toEqual([
      running,
      { ...doomed, state: 'failed' },
    ]);
  });

  it('deleteSession purges turns, bindings, and operations but keeps prompts shared with a fork', async () => {
    const { path, database } = await databaseWithSessions('s-parent', 's-fork');
    const store = createConversationStore(database.client);
    await store.persistTurnIntent({
      turn: turn({
        turnId: 't-shared',
        sessionId: SessionIdSchema.parse('s-parent'),
        input: { type: 'prompt', promptId: PromptIdSchema.parse('p-shared') },
      }),
      prompt: prompt('p-shared'),
      operation: openOperation('op-1', 's-parent'),
    });
    await store.resolveOperation({
      ...openOperation('op-1', 's-parent'),
      state: 'succeeded',
      turnId: TurnIdSchema.parse('t-shared'),
      resolvedAt: 5,
    });
    await store.persistTurnIntent({
      turn: turn({
        turnId: 't-own',
        sessionId: SessionIdSchema.parse('s-parent'),
        input: { type: 'prompt', promptId: PromptIdSchema.parse('p-own') },
        createdAt: 2,
      }),
      prompt: prompt('p-own'),
      operation: openOperation('op-2', 's-parent'),
    });
    // The fork's copied turn row references the shared prompt by id.
    await store.saveTurn(
      turn({
        turnId: 't-copy',
        sessionId: SessionIdSchema.parse('s-fork'),
        input: { type: 'prompt', promptId: PromptIdSchema.parse('p-shared') },
      }),
    );
    await store.saveBinding(
      ProviderTurnBindingSchema.parse({
        turnId: 't-shared',
        runId: 'run-1',
        historyId: 'native-1',
        checkpoint: 'c',
        capturedFrom: 'live',
      }),
    );

    await store.deleteSession(SessionIdSchema.parse('s-parent'));

    closeDatabase(database);
    const reopened = createConversationStore(openDatabase(path).client);
    expect(await reopened.listTurns(SessionIdSchema.parse('s-parent'))).toEqual([]);
    expect(await reopened.listBindings(TurnIdSchema.parse('t-shared'))).toEqual([]);
    expect(await reopened.listOpenOperations()).toEqual([]);
    expect(await reopened.getPrompt(PromptIdSchema.parse('p-own'))).toBeUndefined();
    expect(await reopened.getPrompt(PromptIdSchema.parse('p-shared'))).toEqual(prompt('p-shared'));
    expect(await reopened.listTurns(SessionIdSchema.parse('s-fork'))).toHaveLength(1);

    await reopened.deleteSession(SessionIdSchema.parse('s-fork'));
    expect(await reopened.getPrompt(PromptIdSchema.parse('p-shared'))).toBeUndefined();
  });

  it('refuses a second intent while the session has an open operation', async () => {
    const database = await databaseWithSessions('s-1', 's-2');
    const store = createConversationStore(database);
    await store.persistTurnIntent({
      turn: turn({ turnId: 't-1' }),
      operation: openOperation('op-1'),
    });

    await expect(async () =>
      store.persistTurnIntent({
        turn: turn({ turnId: 't-2', createdAt: 2 }),
        operation: openOperation('op-2'),
      }),
    ).rejects.toBeInstanceOf(ConversationSessionBusyError);
    // The rejected transaction rolled back whole: no turn row either.
    expect(await store.listTurns(SessionIdSchema.parse('s-1'))).toHaveLength(1);
    expect(await store.listOpenOperations(SessionIdSchema.parse('s-1'))).toEqual([
      openOperation('op-1'),
    ]);

    // Another session is not gated by this one's open operation.
    await store.persistTurnIntent({
      turn: turn({ turnId: 't-other', sessionId: SessionIdSchema.parse('s-2') }),
      operation: openOperation('op-other', 's-2'),
    });
  });

  it('assigns sibling ordinals in the transaction and the unique index rejects duplicates', async () => {
    const database = await databaseWithSessions('s-1');
    const store = createConversationStore(database);
    const first = await store.persistTurnIntent({
      turn: turn({ turnId: 't-1' }),
      operation: openOperation('op-1'),
    });
    await store.resolveOperation({
      ...openOperation('op-1'),
      state: 'succeeded',
      turnId: first.turnId,
      resolvedAt: 5,
    });
    const second = await store.persistTurnIntent({
      turn: turn({ turnId: 't-2', createdAt: 2 }),
      operation: openOperation('op-2'),
    });
    expect([first.siblingOrdinal, second.siblingOrdinal]).toEqual([1, 2]);

    // Belt-and-braces: even a direct save cannot mint a duplicate (session, parent, ordinal).
    await expect(async () =>
      store.saveTurn(turn({ turnId: 't-dupe', siblingOrdinal: 2, createdAt: 3 })),
    ).rejects.toThrow('UNIQUE');
    await store.saveTurn(
      turn({ turnId: 't-child', parentTurnId: TurnIdSchema.parse('t-1'), createdAt: 4 }),
    );
    await expect(async () =>
      store.saveTurn(
        turn({ turnId: 't-child-dupe', parentTurnId: TurnIdSchema.parse('t-1'), createdAt: 5 }),
      ),
    ).rejects.toThrow('UNIQUE');
  });

  it('refuses a replayed operation id instead of re-opening the terminal row', async () => {
    const database = await databaseWithSessions('s-1');
    const store = createConversationStore(database);
    const first = await store.persistTurnIntent({
      turn: turn({ turnId: 't-1' }),
      operation: openOperation('op-1'),
    });
    const failed = ConversationOperationSchema.parse({
      operationId: 'op-1',
      sessionId: 's-1',
      kind: 'turn.submit',
      state: 'failed',
      error: { code: 'timeout', message: 'too slow' },
      createdAt: 4,
      resolvedAt: 6,
    });
    await store.resolveOperation(failed, { ...first, state: 'failed' });

    await expect(async () =>
      store.persistTurnIntent({
        turn: turn({ turnId: 't-replayed', createdAt: 2 }),
        operation: openOperation('op-1'),
      }),
    ).rejects.toThrow('UNIQUE');
    expect(await store.getOperation(OperationIdSchema.parse('op-1'))).toEqual(failed);
  });

  it('resolveOperation transitions open rows only — the first terminal result stands', async () => {
    const database = await databaseWithSessions('s-1');
    const store = createConversationStore(database);
    const first = await store.persistTurnIntent({
      turn: turn({ turnId: 't-1' }),
      operation: openOperation('op-1'),
    });
    const failed = ConversationOperationSchema.parse({
      operationId: 'op-1',
      sessionId: 's-1',
      kind: 'turn.submit',
      state: 'failed',
      error: { code: 'timeout', message: 'too slow' },
      createdAt: 4,
      resolvedAt: 6,
    });
    expect(await store.resolveOperation(failed, { ...first, state: 'failed' })).toBe(true);

    // A late success must not overwrite the stored failure or flip the failed turn.
    expect(
      await store.resolveOperation(
        {
          ...openOperation('op-1'),
          state: 'succeeded',
          turnId: first.turnId,
          resolvedAt: 7,
        },
        { ...first, state: 'running' },
      ),
    ).toBe(false);

    const reopened = createConversationStore(database);
    expect(await reopened.getOperation(OperationIdSchema.parse('op-1'))).toEqual(failed);
    expect(await reopened.listTurns(SessionIdSchema.parse('s-1'))).toEqual([
      { ...first, state: 'failed' },
    ]);
  });
});
