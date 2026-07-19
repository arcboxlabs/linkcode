import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { WorkspaceId, WorkspaceKind, WorkspaceRecord } from '@linkcode/schema';
import { normalizeCwdKey, workspaceKind } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { OperationError, RequestError } from '../failure';
import type { WorkspaceStore } from './workspace-store';
import { InMemoryWorkspaceStore } from './workspace-store';

/**
 * The Engine's in-memory index of registered directories, keyed by a {@link normalizeCwdKey}'d
 * `cwd` so the same directory always resolves to one record. Session start/resume calls
 * {@link touch} to auto-register; `register` is the explicit, client-driven path.
 */
export class WorkspaceRegistry {
  private readonly byId = new Map<WorkspaceId, WorkspaceRecord>();
  private readonly byCwdKey = new Map<string, WorkspaceId>();
  /** `normalizeCwdKey`'d cwd of the daemon-owned chat root (null until {@link ensureChatWorkspace}
   * runs); a cwd auto-registered via {@link touch} that matches becomes `chat`, not `project`. */
  private chatRootKey: string | null = null;
  private seq = 0;

  constructor(private readonly store: WorkspaceStore = new InMemoryWorkspaceStore()) {}

  async start(): Promise<void> {
    const records = await storeOperation('workspace.load', 'Failed to load workspaces', () =>
      this.store.load(),
    );
    for (const record of records) {
      this.index(record);
    }
  }

  /** Every registered workspace, most recently used first. */
  list(): WorkspaceRecord[] {
    return [...this.byId.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  /** The workspace registered for a directory, if any. */
  findByCwd(cwd: string): WorkspaceRecord | undefined {
    const id = this.byCwdKey.get(normalizeCwdKey(cwd));
    return id === undefined ? undefined : this.byId.get(id);
  }

  /** Explicitly register a directory. Idempotent: an already-known directory just gets its
   * `lastUsedAt` freshened and keeps its `kind` (see {@link upsert}). Rejects a `cwd` that isn't
   * an existing directory — unlike {@link touch}, there is no session to fall back on. */
  async register(opts: {
    cwd: string;
    name?: string;
    kind?: WorkspaceKind;
  }): Promise<WorkspaceRecord> {
    const cwd = resolve(opts.cwd);
    await this.assertDirectoryExists(cwd);
    return this.upsert(cwd, opts.name, opts.kind ?? 'project');
  }

  /** Ensure a directory a session just ran in is registered: freshen `lastUsedAt` if known, else
   * create a record — `chat` if `cwd` is the daemon-owned chat root, `project` otherwise. */
  touch(cwd: string, name?: string): Promise<WorkspaceRecord> {
    const resolved = resolve(cwd);
    const kind =
      this.chatRootKey !== null && normalizeCwdKey(resolved) === this.chatRootKey
        ? 'chat'
        : 'project';
    return this.upsert(resolved, name, kind);
  }

  /** Ensure the daemon-owned chat root exists and is registered as the `chat` workspace,
   * upgrading an existing `project` record in place (keeping its `workspaceId`). Called once at
   * daemon startup, before any client can connect; {@link touch} then recognizes the directory. */
  async ensureChatWorkspace(cwd: string): Promise<WorkspaceRecord> {
    const resolved = resolve(cwd);
    await mkdir(resolved, { recursive: true });
    const key = normalizeCwdKey(resolved);
    this.chatRootKey = key;

    const existingId = this.byCwdKey.get(key);
    if (!existingId) return this.upsert(resolved, undefined, 'chat');

    const existing = nullthrow(this.byId.get(existingId), `Unindexed workspace: ${existingId}`);
    if (workspaceKind(existing) !== 'chat') {
      const upgraded = { ...existing, kind: 'chat' as const };
      await this.save(upgraded);
      this.index(upgraded);
      return upgraded;
    }
    return existing;
  }

  async update(workspaceId: WorkspaceId, name: string): Promise<WorkspaceRecord> {
    const record = this.byId.get(workspaceId);
    if (!record) {
      throw new RequestError({
        code: 'not_found',
        message: `Unknown workspace: ${workspaceId}`,
      });
    }
    if (workspaceKind(record) === 'chat') {
      throw new RequestError({
        code: 'conflict',
        message: `Cannot rename the chat workspace: ${workspaceId}`,
      });
    }
    const updated = { ...record, name };
    await this.save(updated);
    this.index(updated);
    return updated;
  }

  /** Drop a workspace from the registry only — this never touches the directory on disk. */
  async archive(workspaceId: WorkspaceId): Promise<void> {
    const record = this.byId.get(workspaceId);
    if (!record) return;
    if (workspaceKind(record) === 'chat') {
      throw new RequestError({
        code: 'conflict',
        message: `Cannot archive the chat workspace: ${workspaceId}`,
      });
    }
    await storeOperation('workspace.delete', 'Failed to archive workspace', () =>
      this.store.delete(workspaceId),
    );
    this.byId.delete(workspaceId);
    this.byCwdKey.delete(normalizeCwdKey(record.cwd));
  }

  /** Resolves `cwd` to an absolute path first (the wire boundary) so `register` and `touch`
   * always dedupe against the same key; `kind` only applies when minting a brand-new record —
   * an already-known directory keeps its persisted `kind` untouched. */
  private async upsert(
    rawCwd: string,
    name: string | undefined,
    kind: WorkspaceKind,
  ): Promise<WorkspaceRecord> {
    const cwd = resolve(rawCwd);
    const key = normalizeCwdKey(cwd);
    const existingId = this.byCwdKey.get(key);
    const now = Date.now();
    if (existingId) {
      const existing = nullthrow(this.byId.get(existingId), `Unindexed workspace: ${existingId}`);
      const updated = { ...existing, lastUsedAt: now };
      await this.save(updated);
      this.index(updated);
      return updated;
    }
    const record: WorkspaceRecord = {
      workspaceId: this.nextWorkspaceId(),
      cwd,
      name: name ?? lastPathSegment(cwd),
      kind,
      createdAt: now,
      lastUsedAt: now,
    };
    await this.save(record);
    this.index(record);
    return record;
  }

  private index(record: WorkspaceRecord): void {
    this.byId.set(record.workspaceId, record);
    this.byCwdKey.set(normalizeCwdKey(record.cwd), record.workspaceId);
  }

  private save(record: WorkspaceRecord): Promise<void> {
    return storeOperation('workspace.save', 'Failed to persist workspace', () =>
      this.store.save(record),
    );
  }

  private nextWorkspaceId(): WorkspaceId {
    this.seq += 1;
    return `ws-${Date.now().toString(36)}-${this.seq.toString(36)}` as WorkspaceId;
  }

  private async assertDirectoryExists(cwd: string): Promise<void> {
    let stats: Awaited<ReturnType<typeof stat>>;
    try {
      stats = await stat(cwd);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new RequestError({
          code: 'not_found',
          message: `Workspace directory does not exist: ${cwd}`,
        });
      }
      throw new OperationError({
        subsystem: 'filesystem',
        operation: 'workspace.stat',
        publicMessage: 'Failed to inspect workspace directory',
        cause: error,
      });
    }
    if (!stats.isDirectory()) {
      throw new RequestError({
        code: 'invalid_request',
        message: `Workspace path is not a directory: ${cwd}`,
      });
    }
  }
}

async function storeOperation<A>(
  operation: string,
  publicMessage: string,
  run: () => Promise<A>,
): Promise<A> {
  try {
    return await run();
  } catch (error) {
    throw new OperationError({ subsystem: 'store', operation, publicMessage, cause: error });
  }
}

const PATH_SEPARATORS_RE = /[/\\]+/;

function lastPathSegment(cwd: string): string {
  const parts = cwd.split(PATH_SEPARATORS_RE).filter(Boolean);
  return parts.at(-1) ?? cwd;
}
