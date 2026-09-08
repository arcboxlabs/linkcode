import type { SessionId, WorktreeLease, WorktreeRecord } from '@linkcode/schema';

export interface WorktreeStoreSnapshot {
  readonly worktrees: WorktreeRecord[];
  readonly leases: WorktreeLease[];
}

/** What a released lease was: the worktree it held, and whether it was the last hold on it. */
export interface WorktreeLeaseRelease {
  readonly worktreePath: string;
  readonly last: boolean;
}

/** Rejection from {@link WorktreeStore.acquireLease}: the worktree is gone or `deleting`, so a
 * lease on it would name a directory cleanup is about to remove. */
export class WorktreeUnavailableError extends Error {
  constructor(worktreePath: string, options?: ErrorOptions) {
    super(`Managed worktree is unavailable: ${worktreePath}`, options);
    this.name = 'WorktreeUnavailableError';
  }
}

/**
 * Durable managed-worktree registry: worktree rows and the session leases on them. The daemon
 * injects a SQLite implementation on the graph connection — lease release and the `deleting` mark
 * MUST be one transaction there; the in-memory default is for tests and embedders.
 */
export interface WorktreeStore {
  load(): Promise<WorktreeStoreSnapshot>;
  /** Upsert the worktree row for creation and orphan-marking; leases are untouched. It does not
   * police state, so callers never write `active` over a `deleting` row — that only ever holds
   * when zero leases remain (the release that set it). */
  save(record: WorktreeRecord): Promise<void>;
  /** Remove the worktree row and every lease on it. */
  delete(worktreePath: string): Promise<void>;
  /** Grant `sessionId` its hold; idempotent for the same worktree. Rejects with
   * {@link WorktreeUnavailableError} when the worktree is missing or `deleting`. */
  acquireLease(worktreePath: string, sessionId: SessionId): Promise<void>;
  /** Drop the session's hold; when it was the last one the worktree is marked `deleting` in the
   * same transaction, before any filesystem work. Undefined when the session held none. */
  releaseLease(sessionId: SessionId): Promise<WorktreeLeaseRelease | undefined>;
}

export class InMemoryWorktreeStore implements WorktreeStore {
  private readonly records = new Map<string, WorktreeRecord>();
  private readonly leases = new Map<SessionId, WorktreeLease>();

  load(): Promise<WorktreeStoreSnapshot> {
    return Promise.resolve({
      worktrees: Array.from(this.records.values(), (record) => structuredClone(record)),
      leases: Array.from(this.leases.values(), (lease) => structuredClone(lease)),
    });
  }

  save(record: WorktreeRecord): Promise<void> {
    for (const existing of this.records.values()) {
      if (existing.worktreePath === record.worktreePath) continue;
      if (existing.repoRoot === record.repoRoot && existing.branch === record.branch) {
        return Promise.reject(new Error('worktree already exists'));
      }
    }
    this.records.set(record.worktreePath, structuredClone(record));
    return Promise.resolve();
  }

  delete(worktreePath: string): Promise<void> {
    this.records.delete(worktreePath);
    for (const [sessionId, lease] of this.leases) {
      if (lease.worktreePath === worktreePath) this.leases.delete(sessionId);
    }
    return Promise.resolve();
  }

  acquireLease(worktreePath: string, sessionId: SessionId): Promise<void> {
    const record = this.records.get(worktreePath);
    if (record === undefined || record.state === 'deleting') {
      return Promise.reject(new WorktreeUnavailableError(worktreePath));
    }
    const held = this.leases.get(sessionId);
    if (held !== undefined && held.worktreePath !== worktreePath) {
      return Promise.reject(new Error(`Session ${sessionId} already holds a worktree`));
    }
    if (held === undefined) {
      this.leases.set(sessionId, { worktreePath, sessionId, createdAt: Date.now() });
    }
    return Promise.resolve();
  }

  releaseLease(sessionId: SessionId): Promise<WorktreeLeaseRelease | undefined> {
    const lease = this.leases.get(sessionId);
    if (lease === undefined) return Promise.resolve(undefined);
    this.leases.delete(sessionId);
    let remaining = 0;
    for (const other of this.leases.values()) {
      if (other.worktreePath === lease.worktreePath) remaining += 1;
    }
    const last = remaining === 0;
    const record = this.records.get(lease.worktreePath);
    if (last && record !== undefined) record.state = 'deleting';
    return Promise.resolve({ worktreePath: lease.worktreePath, last });
  }
}
