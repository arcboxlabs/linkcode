import type { SessionStore } from '@linkcode/engine';
import type { SessionRecord } from '@linkcode/schema';
import { SessionRecordSchema } from '@linkcode/schema';
import { asc, eq } from 'drizzle-orm';
import { nullthrow } from 'foxts/guard';
import type { DaemonDatabaseClient } from './db/database';
import { sessionRuns, sessions } from './db/schema';

type SessionRow = typeof sessions.$inferSelect;
type RunRow = typeof sessionRuns.$inferSelect;

/**
 * SQLite-backed `SessionStore` borrowing the shared graph/session connection. Rows are validated
 * back through `SessionRecordSchema` on load — the zod schema stays the contract.
 */
export function createSessionStore(db: DaemonDatabaseClient): SessionStore {
  return {
    load(): Promise<SessionRecord[]> {
      const sessionRows = db.select().from(sessions).all();
      const runRows = db
        .select()
        .from(sessionRuns)
        .orderBy(asc(sessionRuns.sessionId), asc(sessionRuns.seq))
        .all();
      const runsBySession = new Map<string, RunRow[]>();
      for (let i = 0, len = runRows.length; i < len; i++) {
        const run = runRows[i];
        const bucket = runsBySession.get(run.sessionId);
        if (bucket) bucket.push(run);
        else runsBySession.set(run.sessionId, [run]);
      }
      return Promise.resolve(
        sessionRows.map((row) => toRecord(row, runsBySession.get(row.sessionId) ?? [])),
      );
    },

    save(record: SessionRecord): Promise<void> {
      const row = toSessionRow(record);
      db.transaction((tx) => {
        tx.insert(sessions)
          .values(row)
          .onConflictDoUpdate({ target: sessions.sessionId, set: row })
          .run();
        // Runs are few per session; rewriting them keeps save() a whole-record upsert.
        tx.delete(sessionRuns).where(eq(sessionRuns.sessionId, record.sessionId)).run();
        if (record.runs.length > 0) {
          tx.insert(sessionRuns)
            .values(
              record.runs.map((run, seq) => ({
                sessionId: record.sessionId,
                seq,
                // runId is optional at the wire parse boundary only; every writer mints it, so a
                // runId-less run here is a bug — minting one would drift the durable id per save.
                runId: nullthrow(run.runId, `Session run without runId: ${record.sessionId}`),
                baseTurnId: run.baseTurnId ?? null,
                historyId: run.historyId ?? null,
                accountId: run.accountId ?? null,
                model: run.model ?? null,
                effort: run.effort ?? null,
                approvalPolicyId: run.approvalPolicyId ?? null,
                startedAt: run.startedAt,
                endedAt: run.endedAt ?? null,
              })),
            )
            .run();
        }
      });
      return Promise.resolve();
    },

    delete(sessionId): Promise<void> {
      // Runs cascade via the foreign key.
      db.delete(sessions).where(eq(sessions.sessionId, sessionId)).run();
      return Promise.resolve();
    },
  };
}

function toSessionRow(record: SessionRecord): typeof sessions.$inferInsert {
  return {
    sessionId: record.sessionId,
    kind: record.kind,
    cwd: record.cwd,
    title: record.title ?? null,
    originType: record.origin.type,
    originHistoryId: record.origin.type === 'imported' ? record.origin.historyId : null,
    originImportedAt: record.origin.type === 'imported' ? record.origin.importedAt : null,
    originSourceSessionId: record.forkOrigin?.sourceSessionId ?? null,
    originSourceTurnId: record.forkOrigin?.sourceTurnId ?? null,
    originForkedAt: record.forkOrigin?.forkedAt ?? null,
    createdVia: record.createdVia ?? null,
    automationKind: record.automation?.kind ?? null,
    automationId: record.automation?.id ?? null,
    activeLeafTurnId: record.activeLeafTurnId ?? null,
    graphRevision: record.graphRevision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toRecord(row: SessionRow, runRows: RunRow[]): SessionRecord {
  return SessionRecordSchema.parse({
    sessionId: row.sessionId,
    kind: row.kind,
    cwd: row.cwd,
    title: row.title ?? undefined,
    origin: toOrigin(row),
    forkOrigin: toForkOrigin(row),
    createdVia: row.createdVia ?? undefined,
    automation:
      row.automationKind && row.automationId
        ? { kind: row.automationKind, id: row.automationId }
        : undefined,
    activeLeafTurnId: row.activeLeafTurnId ?? undefined,
    graphRevision: row.graphRevision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    runs: runRows.map((run) => ({
      runId: run.runId ?? undefined,
      baseTurnId: run.baseTurnId ?? undefined,
      historyId: run.historyId ?? undefined,
      accountId: run.accountId ?? undefined,
      model: run.model ?? undefined,
      effort: run.effort ?? undefined,
      approvalPolicyId: run.approvalPolicyId ?? undefined,
      startedAt: run.startedAt,
      endedAt: run.endedAt ?? undefined,
    })),
  });
}

function toOrigin(row: SessionRow): unknown {
  if (row.originType === 'imported') {
    return { type: 'imported', historyId: row.originHistoryId, importedAt: row.originImportedAt };
  }
  return { type: 'created' };
}

function toForkOrigin(row: SessionRow): unknown {
  if (
    row.originType !== 'forked' &&
    row.originSourceSessionId === null &&
    row.originSourceTurnId === null &&
    row.originForkedAt === null
  ) {
    return undefined;
  }
  return {
    sourceSessionId: row.originSourceSessionId,
    sourceTurnId: row.originSourceTurnId,
    forkedAt: row.originForkedAt,
  };
}
