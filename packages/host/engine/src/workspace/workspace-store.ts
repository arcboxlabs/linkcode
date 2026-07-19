import type { WorkspaceId, WorkspaceRecord } from '@linkcode/schema';

/** Durable storage for workspace records (registered directories). The daemon injects a database-
 * backed implementation; the in-memory default keeps bare engines and tests dependency-free. */
export interface WorkspaceStore {
  load(): Promise<WorkspaceRecord[]>;
  save(record: WorkspaceRecord): void | Promise<void>;
  delete(workspaceId: WorkspaceId): void | Promise<void>;
}

export class InMemoryWorkspaceStore implements WorkspaceStore {
  private readonly records = new Map<WorkspaceId, WorkspaceRecord>();

  load(): Promise<WorkspaceRecord[]> {
    return Promise.resolve([...this.records.values()].map((record) => structuredClone(record)));
  }

  save(record: WorkspaceRecord): Promise<void> {
    this.records.set(record.workspaceId, structuredClone(record));
    return Promise.resolve();
  }

  delete(workspaceId: WorkspaceId): Promise<void> {
    this.records.delete(workspaceId);
    return Promise.resolve();
  }
}
