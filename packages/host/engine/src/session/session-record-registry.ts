import type {
  AgentHistoryId,
  ContentBlock,
  SessionId,
  SessionInfo,
  SessionRecord,
} from '@linkcode/schema';
import type { SessionStore } from './session-store';

const TITLE_MAX_LENGTH = 80;

export class SessionRecordRegistry {
  private readonly records = new Map<SessionId, SessionRecord>();

  constructor(private readonly store: SessionStore) {}

  async load(): Promise<void> {
    for (const record of await this.store.load()) this.records.set(record.sessionId, record);
  }

  has(sessionId: SessionId): boolean {
    return this.records.has(sessionId);
  }

  get(sessionId: SessionId): SessionRecord | undefined {
    return this.records.get(sessionId);
  }

  list(statusOf: (sessionId: SessionId) => SessionInfo['status'] | undefined): SessionInfo[] {
    return Array.from(this.records.values(), (record) => ({
      sessionId: record.sessionId,
      kind: record.kind,
      cwd: record.cwd,
      status: statusOf(record.sessionId) ?? 'stopped',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      title: record.title,
      origin: record.origin,
      createdVia: record.createdVia,
      automation: record.automation,
      historyId: latestHistoryId(record),
    }));
  }

  /** Register before session startup settles; persistence failures must not orphan a live adapter. */
  register(record: SessionRecord): void {
    this.records.set(record.sessionId, record);
    this.persist(record);
  }

  /** Imported records have no live adapter, so a store failure remains request-fatal. */
  async importRecord(record: SessionRecord): Promise<void> {
    this.records.set(record.sessionId, record);
    await this.store.save(record);
  }

  /** Delete from durable storage first so a failed delete leaves the in-memory record retryable. */
  async delete(sessionId: SessionId): Promise<void> {
    await this.store.delete(sessionId);
    this.records.delete(sessionId);
  }

  bindHistoryId(sessionId: SessionId, historyId: AgentHistoryId): void {
    const record = this.records.get(sessionId);
    const run = record?.runs.at(-1);
    if (!record || !run || run.historyId === historyId) return;
    run.historyId = historyId;
    this.persist(record);
  }

  sealCurrentRun(sessionId: SessionId): void {
    const record = this.records.get(sessionId);
    const run = record?.runs.at(-1);
    if (!record || !run || run.endedAt !== undefined) return;
    run.endedAt = Date.now();
    this.persist(record);
  }

  setTitleFromContent(sessionId: SessionId, content: ContentBlock[]): void {
    const record = this.records.get(sessionId);
    if (!record || record.title !== undefined) return;
    const title = titleFromContent(content);
    if (title === undefined) return;
    record.title = title;
    this.persist(record);
  }

  historyId(sessionId: SessionId): AgentHistoryId | undefined {
    const record = this.records.get(sessionId);
    return record ? latestHistoryId(record) : undefined;
  }

  /** The in-memory record is authoritative while running; persistence is best-effort. */
  private persist(record: SessionRecord): void {
    record.updatedAt = Date.now();
    void this.persistSafely(record);
  }

  private async persistSafely(record: SessionRecord): Promise<void> {
    try {
      await this.store.save(record);
    } catch (error) {
      console.error(`Failed to persist session record ${record.sessionId}:`, error);
    }
  }
}

function latestHistoryId(record: SessionRecord): AgentHistoryId | undefined {
  for (let index = record.runs.length - 1; index >= 0; index -= 1) {
    const historyId = record.runs[index].historyId;
    if (historyId !== undefined) return historyId;
  }
  return record.origin.type === 'imported' ? record.origin.historyId : undefined;
}

function titleFromContent(content: ContentBlock[]): string | undefined {
  for (const block of content) {
    if (block.type !== 'text') continue;
    const text = block.text.trim().replaceAll(/\s+/g, ' ');
    if (text.length === 0) continue;
    return text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH - 1)}…` : text;
  }
  return undefined;
}
