import type { ConversationStore, ConversationTurnIntent } from '@linkcode/engine';
import { ConversationSessionBusyError } from '@linkcode/engine';
import type {
  ConversationOperation,
  ConversationTurn,
  OperationId,
  PromptId,
  PromptRecord,
  ProviderTurnBinding,
  SessionId,
  TurnId,
} from '@linkcode/schema';
import {
  ConversationOperationSchema,
  ConversationTurnSchema,
  PromptRecordSchema,
  ProviderTurnBindingSchema,
} from '@linkcode/schema';
import { and, asc, count, eq, inArray, isNotNull, isNull, notInArray } from 'drizzle-orm';
import type { DaemonDatabaseClient } from './db/database';
import {
  conversationOperations,
  conversationTurns,
  promptAttachmentRefs,
  prompts,
  providerTurnBindings,
} from './db/schema';

type TurnRow = typeof conversationTurns.$inferSelect;
type PromptRow = typeof prompts.$inferSelect;
type OperationRow = typeof conversationOperations.$inferSelect;

type Db = DaemonDatabaseClient;
type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * SQLite-backed `ConversationStore` on the daemon's shared graph/session connection. Multi-table
 * methods run in `db.transaction`; rows are validated back through the zod schemas on load.
 */
export function createConversationStore(db: DaemonDatabaseClient): ConversationStore {
  function upsertTurn(tx: DbOrTx, turn: ConversationTurn): void {
    const row = toTurnRow(turn);
    tx.insert(conversationTurns)
      .values(row)
      .onConflictDoUpdate({ target: conversationTurns.turnId, set: row })
      .run();
  }

  return {
    listTurns(sessionId: SessionId): Promise<ConversationTurn[]> {
      const rows = db
        .select()
        .from(conversationTurns)
        .where(eq(conversationTurns.sessionId, sessionId))
        .orderBy(asc(conversationTurns.createdAt), asc(conversationTurns.turnId))
        .all();
      return Promise.resolve(rows.map(toTurn));
    },

    saveTurn(turn: ConversationTurn): Promise<void> {
      upsertTurn(db, turn);
      return Promise.resolve();
    },

    getPrompt(promptId: PromptId): Promise<PromptRecord | undefined> {
      const row = db.select().from(prompts).where(eq(prompts.promptId, promptId)).get();
      return Promise.resolve(row ? toPrompt(row) : undefined);
    },

    listBindings(turnId: TurnId): Promise<ProviderTurnBinding[]> {
      const rows = db
        .select()
        .from(providerTurnBindings)
        .where(eq(providerTurnBindings.turnId, turnId))
        .orderBy(asc(providerTurnBindings.historyId))
        .all();
      return Promise.resolve(rows.map((row) => ProviderTurnBindingSchema.parse(row)));
    },

    saveBinding(binding: ProviderTurnBinding): Promise<void> {
      db.insert(providerTurnBindings)
        .values(binding)
        .onConflictDoUpdate({
          target: [providerTurnBindings.turnId, providerTurnBindings.historyId],
          set: binding,
        })
        .run();
      return Promise.resolve();
    },

    getOperation(operationId: OperationId): Promise<ConversationOperation | undefined> {
      const row = db
        .select()
        .from(conversationOperations)
        .where(eq(conversationOperations.operationId, operationId))
        .get();
      return Promise.resolve(row ? toOperation(row) : undefined);
    },

    listOpenOperations(sessionId?: SessionId): Promise<ConversationOperation[]> {
      const open = eq(conversationOperations.state, 'open');
      const rows = db
        .select()
        .from(conversationOperations)
        .where(sessionId ? and(open, eq(conversationOperations.sessionId, sessionId)) : open)
        .all();
      return Promise.resolve(rows.map(toOperation));
    },

    persistTurnIntent(intent: ConversationTurnIntent): Promise<ConversationTurn> {
      const { parentTurnId, sessionId } = intent.turn;
      const persisted = db.transaction((tx) => {
        const open = tx
          .select({ operationId: conversationOperations.operationId })
          .from(conversationOperations)
          .where(
            and(
              eq(conversationOperations.sessionId, sessionId),
              eq(conversationOperations.state, 'open'),
            ),
          )
          .get();
        if (open) throw new ConversationSessionBusyError(sessionId);
        const siblings = tx
          .select({ value: count() })
          .from(conversationTurns)
          .where(
            and(
              eq(conversationTurns.sessionId, sessionId),
              parentTurnId === null
                ? isNull(conversationTurns.parentTurnId)
                : eq(conversationTurns.parentTurnId, parentTurnId),
            ),
          )
          .get();
        const turn: ConversationTurn = {
          ...intent.turn,
          siblingOrdinal: (siblings?.value ?? 0) + 1,
        };
        const prompt =
          intent.turn.input.type === 'prompt' && intent.turn.input.promptId !== null
            ? intent.prompt
            : undefined;
        if (prompt) {
          // Prompts are immutable and shared across forks; a re-referencing insert is a no-op.
          tx.insert(prompts).values(toPromptRow(prompt)).onConflictDoNothing().run();
          const referenced = attachmentIdsOf(prompt);
          if (referenced.length > 0) {
            tx.insert(promptAttachmentRefs)
              .values(
                referenced.map((attachmentId) => ({ promptId: prompt.promptId, attachmentId })),
              )
              .onConflictDoNothing()
              .run();
          }
        }
        // Plain inserts: a replayed operationId must conflict here, never re-open a terminal row.
        tx.insert(conversationTurns).values(toTurnRow(turn)).run();
        tx.insert(conversationOperations).values(toOperationRow(intent.operation)).run();
        return turn;
      });
      return Promise.resolve(persisted);
    },

    resolveOperation(operation: ConversationOperation, turn?: ConversationTurn): Promise<boolean> {
      const transitioned = db.transaction((tx) => {
        const result = tx
          .update(conversationOperations)
          .set(toOperationRow(operation))
          .where(
            and(
              eq(conversationOperations.operationId, operation.operationId),
              eq(conversationOperations.state, 'open'),
            ),
          )
          .run();
        // A concurrent resolver already stored a terminal result; the first writer stands.
        if (result.changes === 0) return false;
        if (turn) upsertTurn(tx, turn);
        return true;
      });
      return Promise.resolve(transitioned);
    },

    deleteSession(sessionId: SessionId): Promise<void> {
      db.transaction((tx) => {
        const rows = tx
          .select({ promptId: conversationTurns.promptId })
          .from(conversationTurns)
          .where(
            and(eq(conversationTurns.sessionId, sessionId), isNotNull(conversationTurns.promptId)),
          )
          .all();
        const candidates: string[] = [];
        for (let i = 0, len = rows.length; i < len; i++) {
          const { promptId } = rows[i];
          if (promptId !== null) candidates.push(promptId);
        }
        // Bindings cascade with their turns; refs cascade with their prompts.
        tx.delete(conversationTurns).where(eq(conversationTurns.sessionId, sessionId)).run();
        tx.delete(conversationOperations)
          .where(eq(conversationOperations.sessionId, sessionId))
          .run();
        if (candidates.length > 0) {
          const stillReferenced = tx
            .select({ promptId: conversationTurns.promptId })
            .from(conversationTurns)
            .where(isNotNull(conversationTurns.promptId));
          tx.delete(prompts)
            .where(
              and(
                inArray(prompts.promptId, candidates),
                notInArray(prompts.promptId, stillReferenced),
              ),
            )
            .run();
        }
      });
      return Promise.resolve();
    },
  };
}

function attachmentIdsOf(prompt: PromptRecord): string[] {
  const ids = new Set<string>(prompt.contextAttachmentIds);
  for (let i = 0, len = prompt.blocks.length; i < len; i++) {
    const block = prompt.blocks[i];
    if (block.type === 'attachment_ref') ids.add(block.attachmentId);
  }
  return Array.from(ids);
}

function toPromptRow(prompt: PromptRecord): typeof prompts.$inferInsert {
  return {
    promptId: prompt.promptId,
    blocksJson: JSON.stringify(prompt.blocks),
    contextAttachmentIdsJson: JSON.stringify(prompt.contextAttachmentIds),
    createdAt: prompt.createdAt,
  };
}

function toPrompt(row: PromptRow): PromptRecord {
  return PromptRecordSchema.parse({
    promptId: row.promptId,
    blocks: JSON.parse(row.blocksJson),
    contextAttachmentIds: JSON.parse(row.contextAttachmentIdsJson),
    createdAt: row.createdAt,
  });
}

function toTurnRow(turn: ConversationTurn): typeof conversationTurns.$inferInsert {
  const { input } = turn;
  return {
    turnId: turn.turnId,
    sessionId: turn.sessionId,
    parentTurnId: turn.parentTurnId,
    siblingOrdinal: turn.siblingOrdinal,
    inputType: input.type,
    promptId: input.type === 'prompt' ? input.promptId : null,
    commandName: input.type === 'command' ? input.name : null,
    commandArguments: input.type === 'command' ? (input.arguments ?? null) : null,
    shellCommand: input.type === 'shell-command' ? input.command : null,
    runId: turn.runId,
    state: turn.state,
    createdAt: turn.createdAt,
  };
}

function toTurn(row: TurnRow): ConversationTurn {
  return ConversationTurnSchema.parse({
    turnId: row.turnId,
    sessionId: row.sessionId,
    parentTurnId: row.parentTurnId,
    siblingOrdinal: row.siblingOrdinal,
    input: toTurnInput(row),
    runId: row.runId,
    state: row.state,
    createdAt: row.createdAt,
  });
}

function toTurnInput(row: TurnRow): unknown {
  switch (row.inputType) {
    case 'prompt':
      return { type: 'prompt', promptId: row.promptId };
    case 'command':
      return {
        type: 'command',
        name: row.commandName,
        arguments: row.commandArguments ?? undefined,
      };
    default:
      return { type: 'shell-command', command: row.shellCommand };
  }
}

function toOperationRow(
  operation: ConversationOperation,
): typeof conversationOperations.$inferInsert {
  return {
    operationId: operation.operationId,
    sessionId: operation.sessionId,
    kind: operation.kind,
    state: operation.state,
    turnId: operation.state === 'succeeded' ? operation.turnId : null,
    errorCode: operation.state === 'failed' ? operation.error.code : null,
    errorMessage: operation.state === 'failed' ? operation.error.message : null,
    createdAt: operation.createdAt,
    resolvedAt: operation.state === 'open' ? null : operation.resolvedAt,
  };
}

function toOperation(row: OperationRow): ConversationOperation {
  const base = {
    operationId: row.operationId,
    sessionId: row.sessionId,
    kind: row.kind,
    createdAt: row.createdAt,
  };
  switch (row.state) {
    case 'succeeded':
      return ConversationOperationSchema.parse({
        ...base,
        state: 'succeeded',
        turnId: row.turnId,
        resolvedAt: row.resolvedAt,
      });
    case 'failed':
      return ConversationOperationSchema.parse({
        ...base,
        state: 'failed',
        error: { code: row.errorCode, message: row.errorMessage },
        resolvedAt: row.resolvedAt,
      });
    default:
      return ConversationOperationSchema.parse({ ...base, state: 'open' });
  }
}
