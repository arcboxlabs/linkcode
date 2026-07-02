import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { WorkspaceId, WorkspaceKind, WorkspaceRecord } from '@linkcode/schema';
import { normalizeCwdKey, workspaceKind } from '@linkcode/schema';
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
  /**
   * `normalizeCwdKey`'d cwd of the daemon-owned chat root, set by {@link ensureChatWorkspace}. A
   * cwd auto-registered via {@link touch} that matches this key becomes a `chat` workspace instead
   * of the default `project`; `null` until `ensureChatWorkspace` has run.
   */
  private chatRootKey: string | null = null;
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
   * Explicitly register a directory. Idempotent: an already-known directory just gets its
   * `lastUsedAt` freshened, returning the existing record (its `kind` is never changed by this
   * path — see {@link upsert}). Rejects a `cwd` that isn't an existing directory — unlike
   * {@link touch}, this is a client-driven call with no session to fall back on.
   */
  async register(opts: {
    cwd: string;
    name?: string;
    kind?: WorkspaceKind;
  }): Promise<WorkspaceRecord> {
    const cwd = resolve(opts.cwd);
    await this.assertDirectoryExists(cwd);
    return this.upsert(cwd, opts.name, opts.kind ?? 'project');
  }

  /**
   * Ensure a directory a session just ran in is registered: freshen `lastUsedAt` if known, else
   * create a new record — `chat` if `cwd` is the daemon-owned chat root (see
   * {@link ensureChatWorkspace}), `project` otherwise.
   */
  touch(cwd: string, name?: string): WorkspaceRecord {
    const resolved = resolve(cwd);
    const kind =
      this.chatRootKey !== null && normalizeCwdKey(resolved) === this.chatRootKey
        ? 'chat'
        : 'project';
    return this.upsert(resolved, name, kind);
  }

  /**
   * Ensure the daemon-owned chat root exists and is registered as the `chat` workspace: creates
   * the directory if missing, registers a fresh `chat` record if `cwd` is unknown, or upgrades an
   * existing `project` record to `chat` in place (keeping its `workspaceId`). Called once at
   * daemon startup, before any client can connect — {@link touch} then recognizes the same
   * directory as `chat` on every subsequent auto-registration.
   */
  async ensureChatWorkspace(cwd: string): Promise<WorkspaceRecord> {
    const resolved = resolve(cwd);
    await mkdir(resolved, { recursive: true });
    const key = normalizeCwdKey(resolved);
    this.chatRootKey = key;

    const existingId = this.byCwdKey.get(key);
    if (!existingId) return this.upsert(resolved, undefined, 'chat');

    const existing = nullthrow(this.byId.get(existingId), `Unindexed workspace: ${existingId}`);
    if (workspaceKind(existing) !== 'chat') {
      existing.kind = 'chat';
      this.persist(existing);
    }
    return existing;
  }

  update(workspaceId: WorkspaceId, name: string): WorkspaceRecord {
    const record = nullthrow(this.byId.get(workspaceId), `Unknown workspace: ${workspaceId}`);
    if (workspaceKind(record) === 'chat') {
      throw new Error(`Cannot rename the chat workspace: ${workspaceId}`);
    }
    record.name = name;
    this.persist(record);
    return record;
  }

  /** Drop a workspace from the registry only — this never touches the directory on disk. */
  archive(workspaceId: WorkspaceId): void {
    const record = this.byId.get(workspaceId);
    if (!record) return;
    if (workspaceKind(record) === 'chat') {
      throw new Error(`Cannot archive the chat workspace: ${workspaceId}`);
    }
    this.byId.delete(workspaceId);
    this.byCwdKey.delete(normalizeCwdKey(record.cwd));
    // Same stance as persist(): best-effort. The in-memory index is already gone either way, and
    // it — not the store — is the source of truth for a running daemon.
    void Promise.resolve(this.store.delete(workspaceId)).catch(noop);
  }

  /**
   * Resolves `cwd` to an absolute path first — the wire boundary, since it may arrive as whatever
   * the user typed, a client-relative path, or an already-resolved session cwd — so `register` and
   * `touch` always dedupe against the same key for a given real directory. `kind` only applies when
   * minting a brand-new record; an already-known directory keeps its persisted `kind` untouched.
   */
  private upsert(rawCwd: string, name: string | undefined, kind: WorkspaceKind): WorkspaceRecord {
    const cwd = resolve(rawCwd);
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
      kind,
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

  private async assertDirectoryExists(cwd: string): Promise<void> {
    let stats: Awaited<ReturnType<typeof stat>>;
    try {
      stats = await stat(cwd);
    } catch {
      throw new Error(`Workspace directory does not exist: ${cwd}`);
    }
    if (!stats.isDirectory()) {
      throw new Error(`Workspace path is not a directory: ${cwd}`);
    }
  }
}

const PATH_SEPARATORS_RE = /[/\\]+/;

function lastPathSegment(cwd: string): string {
  const parts = cwd.split(PATH_SEPARATORS_RE).filter(Boolean);
  return parts.at(-1) ?? cwd;
}
