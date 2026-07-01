import { resolve } from 'node:path';
import type { WorkspaceId, WorkspaceRecord } from '@linkcode/schema';
import { normalizeCwdKey } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import type { WorkspaceStore } from './workspace-store';
import { InMemoryWorkspaceStore } from './workspace-store';

/**
 * WorkspaceRegistry: the Engine's in-memory index of registered directories, keyed by a
 * {@link normalizeCwdKey}'d `cwd` so the same directory always resolves to one record regardless
 * of a trailing separator. Session lifecycle (`session.start` / `history.resume`) calls
 * {@link touch} so opening a session in a directory registers or freshens that workspace without
 * the client having to register explicitly first; `register` is the explicit, client-driven path.
 */
export class WorkspaceRegistry {
  private readonly byId = new Map<WorkspaceId, WorkspaceRecord>();
  private readonly byCwdKey = new Map<string, WorkspaceId>();
  private seq = 0;

  constructor(private readonly store: WorkspaceStore = new InMemoryWorkspaceStore()) {}

  async start(): Promise<void> {
    for (const record of await this.store.load()) {
      this.index(record);
    }
  }

  /** Every registered workspace, most recently used first. */
  list(): WorkspaceRecord[] {
    return [...this.byId.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  /**
   * Explicitly register a directory. `cwd` is resolved to an absolute path first — the wire
   * boundary, since it may arrive as whatever the user typed or a client-relative path. Idempotent:
   * an already-known directory just gets its `lastUsedAt` freshened, returning the existing record.
   */
  register(opts: { cwd: string; name?: string }): WorkspaceRecord {
    return this.upsert(resolve(opts.cwd), opts.name);
  }

  /**
   * Ensure a directory a session just ran in is registered: freshen `lastUsedAt` if known, else
   * create a new record. `cwd` here is already the session's resolved working directory.
   */
  touch(cwd: string, name?: string): WorkspaceRecord {
    return this.upsert(cwd, name);
  }

  update(workspaceId: WorkspaceId, name: string): WorkspaceRecord {
    const record = nullthrow(this.byId.get(workspaceId), `Unknown workspace: ${workspaceId}`);
    record.name = name;
    this.persist(record);
    return record;
  }

  /** Drop a workspace from the registry only — this never touches the directory on disk. */
  archive(workspaceId: WorkspaceId): void {
    const record = this.byId.get(workspaceId);
    if (!record) return;
    this.byId.delete(workspaceId);
    this.byCwdKey.delete(normalizeCwdKey(record.cwd));
    // Same stance as persist(): best-effort. The in-memory index is already gone either way, and
    // it — not the store — is the source of truth for a running daemon.
    void Promise.resolve(this.store.delete(workspaceId)).catch(noop);
  }

  private upsert(cwd: string, name?: string): WorkspaceRecord {
    const key = normalizeCwdKey(cwd);
    const existingId = this.byCwdKey.get(key);
    const now = Date.now();
    if (existingId) {
      const existing = nullthrow(this.byId.get(existingId), `Unindexed workspace: ${existingId}`);
      existing.lastUsedAt = now;
      this.persist(existing);
      return existing;
    }
    const record: WorkspaceRecord = {
      workspaceId: this.nextWorkspaceId(),
      cwd,
      name: name ?? lastPathSegment(cwd),
      createdAt: now,
      lastUsedAt: now,
    };
    this.index(record);
    this.persist(record);
    return record;
  }

  private index(record: WorkspaceRecord): void {
    this.byId.set(record.workspaceId, record);
    this.byCwdKey.set(normalizeCwdKey(record.cwd), record.workspaceId);
  }

  /** Persistence failure is a best-effort noop, same stance as the Engine's session persistence. */
  private persist(record: WorkspaceRecord): void {
    void Promise.resolve(this.store.save(record)).catch(noop);
  }

  private nextWorkspaceId(): WorkspaceId {
    this.seq += 1;
    return `ws-${Date.now().toString(36)}-${this.seq.toString(36)}` as WorkspaceId;
  }
}

const PATH_SEPARATORS_RE = /[/\\]+/;

function lastPathSegment(cwd: string): string {
  const parts = cwd.split(PATH_SEPARATORS_RE).filter(Boolean);
  return parts.at(-1) ?? cwd;
}
