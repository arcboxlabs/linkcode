import type { WorktreeRecord } from '@linkcode/schema';

export interface WorktreeStore {
  load(): Promise<WorktreeRecord[]>;
  save(record: WorktreeRecord): Promise<void>;
  delete(worktreePath: string): Promise<void>;
}

export class InMemoryWorktreeStore implements WorktreeStore {
  private readonly records = new Map<string, WorktreeRecord>();

  load(): Promise<WorktreeRecord[]> {
    return Promise.resolve(Array.from(this.records.values(), (record) => structuredClone(record)));
  }

  save(record: WorktreeRecord): Promise<void> {
    for (const existing of this.records.values()) {
      if (existing.worktreePath === record.worktreePath) continue;
      if (
        existing.sessionId === record.sessionId ||
        (existing.repoRoot === record.repoRoot && existing.branch === record.branch)
      ) {
        return Promise.reject(new Error('worktree already exists'));
      }
    }
    this.records.set(record.worktreePath, structuredClone(record));
    return Promise.resolve();
  }

  delete(worktreePath: string): Promise<void> {
    this.records.delete(worktreePath);
    return Promise.resolve();
  }
}
