import type { SessionId, SessionRecord } from '@linkcode/schema';

/**
 * Durable storage for session records (identity + provider-run linkage; transcripts stay in
 * provider-local history). The daemon injects a database-backed implementation; the in-memory
 * default keeps bare engines and tests dependency-free.
 */
export interface SessionStore {
  load(): Promise<SessionRecord[]>;
  save(record: SessionRecord): Promise<void>;
  delete(sessionId: SessionId): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private readonly records = new Map<SessionId, SessionRecord>();

  load(): Promise<SessionRecord[]> {
    return Promise.resolve([...this.records.values()].map((record) => structuredClone(record)));
  }

  save(record: SessionRecord): Promise<void> {
    this.records.set(record.sessionId, structuredClone(record));
    return Promise.resolve();
  }

  delete(sessionId: SessionId): Promise<void> {
    this.records.delete(sessionId);
    return Promise.resolve();
  }
}
