import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { basename, join, normalize, resolve } from 'node:path';
import type { BranchMode, SessionId, StartOptions, WorktreeRecord } from '@linkcode/schema';
import { Effect, Exit, Semaphore } from 'effect';
import type { EngineFailure } from '../failure';
import { OperationError, RequestError } from '../failure';
import type { GitService } from '../git/git-service';
import {
  addWorktree,
  identifyManagedWorktree,
  inspectWorktreeCleanup,
  localBranchExists,
  pruneWorktrees,
  readCurrentBranch,
  removeWorktree,
  removeWorktreeBestEffort,
  resolveRepoRoot,
  switchBranch,
} from '../git/worktrees';
import type { WorktreeStore } from './worktree-store';
import { WorktreeUnavailableError } from './worktree-store';

const RE_UNSAFE_SLUG = /[^\w.-]+/g;
const RE_EDGE_DASHES = /^-+|-+$/g;
const RE_CHECKED_OUT = /already checked out|already used by worktree/i;
const RE_SWITCH_BLOCKED = /would be overwritten|please commit your changes or stash/i;

/**
 * Managed git worktrees and the session leases on them. A worktree is provisioned for one session
 * and shared by every session forked from it; it is cleaned up when its LAST lease goes, and only
 * then — the release marks the row `deleting` durably before any filesystem work, so a fork racing
 * the cleanup is refused typed instead of landing on a directory about to vanish.
 */
export class WorktreeService {
  private readonly byPath = new Map<string, WorktreeRecord>();
  private readonly byRepoBranch = new Map<string, WorktreeRecord>();
  /** The worktree each leasing session holds, by the record's own `worktreePath`. */
  private readonly leaseBySession = new Map<SessionId, string>();
  private readonly semaphores = new Map<string, Semaphore.Semaphore>();

  constructor(
    private readonly store: WorktreeStore,
    readonly root: string | undefined,
    readonly git: GitService,
  ) {}

  start(
    durableSessionIds: ReadonlySet<SessionId> = new Set(),
  ): Effect.Effect<void, OperationError> {
    return storeEffect('worktrees.load', 'Failed to load managed worktrees', () =>
      this.store.load(),
    ).pipe(
      Effect.tap(({ worktrees }) =>
        Effect.sync(() => {
          for (let i = 0, len = worktrees.length; i < len; i++) this.index(worktrees[i]);
        }),
      ),
      // A lease whose session is gone (deleted while the daemon was down) is swept durably; the
      // worktree it held then reconciles below like any other without holders.
      Effect.flatMap(({ leases }) =>
        Effect.forEach(
          leases,
          (lease) =>
            durableSessionIds.has(lease.sessionId)
              ? Effect.sync(() => {
                  this.leaseBySession.set(lease.sessionId, lease.worktreePath);
                })
              : this.release(lease.sessionId).pipe(
                  Effect.asVoid,
                  Effect.catch((error) =>
                    Effect.logWarning('Managed worktree lease sweep deferred', error),
                  ),
                ),
          { discard: true },
        ),
      ),
      Effect.andThen(Effect.suspend(() => this.reconcile())),
    );
  }

  provision(
    options: StartOptions,
    sessionId: SessionId,
  ): Effect.Effect<StartOptions, EngineFailure> {
    if (!options.branch) return Effect.succeed(options);
    const { mode, name: branch } = options.branch;
    return Effect.gen({ self: this }, function* () {
      const rawRoot = yield* resolveRepoRoot(options.cwd).pipe(
        Effect.mapError((cause) =>
          gitFailure('git.repo-root', 'Failed to inspect repository', cause),
        ),
      );
      if (!rawRoot) {
        return yield* new RequestError({
          code: 'invalid_request',
          message: 'Workspace is not a git repository',
        });
      }
      const repoRoot = normalizeRepoRoot(rawRoot);
      return yield* this.semaphore(repoRoot).withPermit(
        this.provisionLocked(options, sessionId, repoRoot, branch, mode),
      );
    });
  }

  /** Give `sessionId` a hold on the worktree another session already holds — a fork shares its
   * source's working tree. Typed `conflict` when the worktree is being removed. */
  acquire(sessionId: SessionId, worktreePath: string): Effect.Effect<void, EngineFailure> {
    return Effect.tryPromise({
      try: () => this.store.acquireLease(worktreePath, sessionId),
      catch: (cause) =>
        cause instanceof WorktreeUnavailableError
          ? new RequestError({
              code: 'conflict',
              message: 'The managed worktree is being removed',
            })
          : new OperationError({
              subsystem: 'store',
              operation: 'worktrees.lease',
              publicMessage: 'Failed to lease the managed worktree',
              cause,
            }),
    }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          this.leaseBySession.set(sessionId, worktreePath);
        }),
      ),
    );
  }

  /** A start in the session's worktree — a resume, or a fork child — needs the directory on disk;
   * the lease alone says nothing about that. */
  verifyResume(sessionId: SessionId): Effect.Effect<void, RequestError> {
    const record = this.get(sessionId);
    if (!record || existsSync(record.worktreePath)) return Effect.void;
    return Effect.fail(
      new RequestError({
        code: 'worktree_missing',
        message: `The managed worktree is missing at ${record.worktreePath}. Restore it or delete this session.`,
      }),
    );
  }

  /** The worktree `sessionId` holds a lease on. */
  get(sessionId: SessionId): WorktreeRecord | undefined {
    const worktreePath = this.leaseBySession.get(sessionId);
    return worktreePath === undefined
      ? undefined
      : this.byPath.get(normalizeRepoRoot(worktreePath));
  }

  /** The other sessions leasing the worktree `sessionId` holds — the ones whose running turn
   * makes this session's next turn `busy`. */
  coLeaseholders(sessionId: SessionId): SessionId[] {
    const worktreePath = this.leaseBySession.get(sessionId);
    if (worktreePath === undefined) return [];
    const others: SessionId[] = [];
    for (const [holder, path] of this.leaseBySession) {
      if (holder !== sessionId && path === worktreePath) others.push(holder);
    }
    return others;
  }

  hasPath(path: string): boolean {
    return this.byPath.has(normalizeRepoRoot(path));
  }

  /** The session is gone: drop its lease, and when it was the last, clean the worktree up. */
  cleanupDeletedSession(sessionId: SessionId): Effect.Effect<void, OperationError> {
    return this.release(sessionId).pipe(
      Effect.flatMap((record) =>
        record === undefined
          ? Effect.void
          : this.semaphore(normalizeRepoRoot(record.repoRoot)).withPermit(
              this.cleanupRecord(record),
            ),
      ),
    );
  }

  /** Release the session's lease; the worktree comes back only when that lease was the last one
   * (the store marked it `deleting`), for the caller to clean up. */
  private release(sessionId: SessionId): Effect.Effect<WorktreeRecord | undefined, OperationError> {
    return storeEffect('worktrees.release', 'Failed to release the managed worktree', () =>
      this.store.releaseLease(sessionId),
    ).pipe(
      Effect.map((released) => {
        this.leaseBySession.delete(sessionId);
        if (!released?.last) return;
        const record = this.byPath.get(normalizeRepoRoot(released.worktreePath));
        if (record === undefined) return;
        const deleting: WorktreeRecord = { ...record, state: 'deleting' };
        this.index(deleting);
        return deleting;
      }),
    );
  }

  provisionLocked(
    options: StartOptions,
    sessionId: SessionId,
    repoRoot: string,
    branch: string,
    mode: BranchMode,
  ): Effect.Effect<StartOptions, EngineFailure> {
    return Effect.gen({ self: this }, function* () {
      const exists = yield* localBranchExists(repoRoot, branch).pipe(
        Effect.mapError((cause) =>
          gitFailure('git.branch.exists', 'Failed to inspect branch', cause),
        ),
      );
      if (!exists) {
        return yield* new RequestError({
          code: 'not_found',
          message: 'The selected local branch does not exist',
        });
      }
      const current = yield* readCurrentBranch(repoRoot).pipe(
        Effect.mapError((cause) =>
          gitFailure('git.branch.current', 'Failed to inspect current branch', cause),
        ),
      );
      if (mode === 'local') {
        return yield* this.provisionLocal(options, repoRoot, branch, current);
      }
      if (current === branch) {
        return yield* new RequestError({
          code: 'conflict',
          message:
            'The selected branch is already checked out in this workspace; choose Local or another branch',
        });
      }
      if (this.byRepoBranch.has(repoBranchKey(repoRoot, branch))) {
        return yield* new RequestError({
          code: 'conflict',
          message: 'This repository branch already has a managed worktree',
        });
      }
      if (!this.root) {
        return yield* new RequestError({
          code: 'unsupported',
          message: 'Managed worktrees are unavailable',
        });
      }
      const worktreePath = makeWorktreePath(this.root, repoRoot, branch);
      const added = yield* addWorktree(repoRoot, worktreePath, branch).pipe(
        Effect.mapError((cause) =>
          gitFailure('git.worktree.add', 'Failed to create managed worktree', cause),
        ),
      );
      if (added.exitCode !== 0) {
        if (RE_CHECKED_OUT.test(added.stderr)) {
          return yield* new RequestError({
            code: 'conflict',
            message: 'The selected branch is already checked out in another worktree',
          });
        }
        return yield* gitFailure(
          'git.worktree.add',
          'Failed to create managed worktree',
          new Error(added.stderr.trim() || `git worktree add exited ${added.exitCode}`),
        );
      }
      const record: WorktreeRecord = {
        worktreePath,
        repoRoot,
        branch,
        createdAt: Date.now(),
        state: 'active',
      };
      // Two writes, not one transaction: a crash between them leaves an active worktree with no
      // lease, which boot reconcile cleans up like any other holder-less worktree.
      const saved = yield* Effect.exit(
        storeEffect('worktrees.save', 'Failed to persist managed worktree', () =>
          this.store.save(record),
        ).pipe(Effect.andThen(this.acquire(sessionId, worktreePath))),
      );
      if (Exit.isFailure(saved)) {
        yield* removeWorktreeBestEffort(repoRoot, worktreePath);
        yield* storeEffect('worktrees.delete', 'Failed to delete managed worktree', () =>
          this.store.delete(worktreePath),
        ).pipe(Effect.catch(() => Effect.void));
        return yield* Effect.failCause(saved.cause);
      }
      this.index(record);
      yield* this.git.invalidate(options.cwd);
      yield* this.git.invalidate(worktreePath);
      return withoutBranch(options, worktreePath);
    });
  }

  provisionLocal(
    options: StartOptions,
    repoRoot: string,
    branch: string,
    current: string | undefined,
  ): Effect.Effect<StartOptions, EngineFailure> {
    if (current === branch) return Effect.succeed(withoutBranch(options, options.cwd));
    return Effect.gen({ self: this }, function* () {
      const switched = yield* switchBranch(repoRoot, branch).pipe(
        Effect.mapError((cause) =>
          gitFailure('git.branch.switch', 'Failed to switch workspace branch', cause),
        ),
      );
      if (switched.exitCode !== 0) {
        if (RE_CHECKED_OUT.test(switched.stderr)) {
          return yield* new RequestError({
            code: 'conflict',
            message: 'The selected branch is already checked out in another worktree',
          });
        }
        if (RE_SWITCH_BLOCKED.test(switched.stderr)) {
          return yield* new RequestError({
            code: 'conflict',
            message: 'Workspace changes prevent switching to the selected branch',
          });
        }
        return yield* gitFailure(
          'git.branch.switch',
          'Failed to switch workspace branch',
          new Error(switched.stderr.trim() || `git switch exited ${switched.exitCode}`),
        );
      }
      yield* this.git.invalidate(options.cwd);
      return withoutBranch(options, options.cwd);
    });
  }

  semaphore(repoRoot: string): Semaphore.Semaphore {
    const existing = this.semaphores.get(repoRoot);
    if (existing) return existing;
    const semaphore = Semaphore.makeUnsafe(1);
    this.semaphores.set(repoRoot, semaphore);
    return semaphore;
  }

  /** Remove a worktree nobody holds: a missing or clean, pushed tree goes with its row; a dirty
   * or unpushed one is kept on disk as `orphaned`. */
  cleanupRecord(record: WorktreeRecord): Effect.Effect<void, OperationError> {
    return Effect.gen({ self: this }, function* () {
      if (!existsSync(record.worktreePath)) {
        yield* this.pruneAdvisory(record.repoRoot);
        yield* this.deleteRecord(record);
        return;
      }
      const safe = yield* inspectWorktreeCleanup(record.worktreePath, record.branch).pipe(
        Effect.catch(() => Effect.succeed(false)),
      );
      if (!safe) {
        yield* this.markOrphaned(record);
        return;
      }
      const removed = yield* removeWorktree(record.repoRoot, record.worktreePath).pipe(
        Effect.mapError((cause) =>
          gitFailure('git.worktree.remove', 'Failed to remove managed worktree', cause),
        ),
      );
      if (removed.exitCode !== 0) {
        return yield* gitFailure(
          'git.worktree.remove',
          'Failed to remove managed worktree',
          new Error(removed.stderr.trim() || `git worktree remove exited ${removed.exitCode}`),
        );
      }
      yield* this.pruneAdvisory(record.repoRoot);
      yield* this.deleteRecord(record);
    });
  }

  /** Boot: a worktree with no remaining holder is cleaned up when safe — an `active` one whose
   * sessions are gone, a `deleting` one whose cleanup the previous daemon never finished, or an
   * `orphaned` one that has become clean and pushed since; a held one whose directory vanished
   * is marked orphaned. Leases were swept in `start`. */
  reconcile(): Effect.Effect<void, OperationError> {
    return Effect.gen({ self: this }, function* () {
      const records = Array.from(this.byPath.values());
      for (let i = 0, len = records.length; i < len; i++) {
        const record = records[i];
        const held = this.holders(record.worktreePath).length > 0;
        if (!existsSync(record.worktreePath)) {
          yield* this.semaphore(normalizeRepoRoot(record.repoRoot)).withPermit(
            (held
              ? this.pruneAdvisory(record.repoRoot).pipe(Effect.andThen(this.markOrphaned(record)))
              : this.cleanupRecord(record)
            ).pipe(
              Effect.catch((error) =>
                Effect.logWarning('Managed worktree reconciliation deferred', error),
              ),
            ),
          );
        } else if (!held) {
          yield* this.semaphore(normalizeRepoRoot(record.repoRoot)).withPermit(
            this.cleanupRecord(record).pipe(
              Effect.catch((error) =>
                Effect.logWarning('Managed worktree reconciliation deferred', error),
              ),
            ),
          );
        }
      }
      yield* this.scanUnknown();
    });
  }

  /** Adopt managed-root directories no row knows: kept as `orphaned`, with no lease. */
  scanUnknown(): Effect.Effect<void> {
    if (!this.root || !existsSync(this.root)) return Effect.void;
    const root = this.root;
    return Effect.gen({ self: this }, function* () {
      const groups = yield* readChildDirectories(root);
      for (let i = 0, len = groups.length; i < len; i++) {
        const group = groups[i];
        const candidates = yield* readChildDirectories(group);
        for (let j = 0, candidateCount = candidates.length; j < candidateCount; j++) {
          const candidate = candidates[j];
          if (this.hasPath(candidate)) continue;
          const identity = yield* identifyManagedWorktree(candidate).pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                yield* Effect.logWarning('Unable to identify unowned managed worktree', error);
              }),
            ),
          );
          if (!identity) continue;
          const record: WorktreeRecord = {
            worktreePath: candidate,
            repoRoot: identity.repoRoot,
            branch: identity.branch,
            createdAt: Date.now(),
            state: 'orphaned',
          };
          yield* this.semaphore(normalizeRepoRoot(identity.repoRoot)).withPermit(
            this.saveRecord(record).pipe(
              Effect.catch((error) =>
                Effect.logWarning('Unable to persist unowned managed worktree', error),
              ),
            ),
          );
        }
      }
    });
  }

  saveRecord(record: WorktreeRecord): Effect.Effect<void, OperationError> {
    return storeEffect('worktrees.save', 'Failed to persist managed worktree', () =>
      this.store.save(record),
    ).pipe(
      Effect.tap(() => Effect.sync(() => this.index(record))),
      Effect.asVoid,
    );
  }

  markOrphaned(record: WorktreeRecord): Effect.Effect<void, OperationError> {
    if (record.state === 'orphaned') return Effect.void;
    return this.saveRecord({ ...record, state: 'orphaned' });
  }

  deleteRecord(record: WorktreeRecord): Effect.Effect<void, OperationError> {
    return storeEffect('worktrees.delete', 'Failed to delete managed worktree', () =>
      this.store.delete(record.worktreePath),
    ).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          this.byPath.delete(normalizeRepoRoot(record.worktreePath));
          this.byRepoBranch.delete(repoBranchKey(record.repoRoot, record.branch));
          const holders = this.holders(record.worktreePath);
          for (let i = 0, len = holders.length; i < len; i++) {
            this.leaseBySession.delete(holders[i]);
          }
        }),
      ),
      Effect.asVoid,
    );
  }

  private holders(worktreePath: string): SessionId[] {
    const key = normalizeRepoRoot(worktreePath);
    const holders: SessionId[] = [];
    for (const [sessionId, path] of this.leaseBySession) {
      if (normalizeRepoRoot(path) === key) holders.push(sessionId);
    }
    return holders;
  }

  private index(record: WorktreeRecord): void {
    this.byPath.set(normalizeRepoRoot(record.worktreePath), record);
    this.byRepoBranch.set(repoBranchKey(record.repoRoot, record.branch), record);
  }

  pruneAdvisory(repoRoot: string): Effect.Effect<void> {
    return pruneWorktrees(repoRoot).pipe(
      Effect.tap((result) =>
        result.exitCode === 0
          ? Effect.void
          : Effect.logWarning('git worktree prune failed', result.stderr),
      ),
      Effect.catch((error) => Effect.logWarning('git worktree prune failed', error)),
      Effect.asVoid,
    );
  }
}

function readChildDirectories(path: string): Effect.Effect<string[]> {
  return Effect.try({
    try: () =>
      readdirSync(path, { withFileTypes: true }).reduce<string[]>((found, entry) => {
        if (entry.isDirectory()) found.push(join(path, entry.name));
        return found;
      }, []),
    catch: (cause) => gitFailure('git.worktree.scan', 'Failed to scan managed worktrees', cause),
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        yield* Effect.logWarning('Managed worktree directory scan deferred', error);
        return new Array<string>();
      }),
    ),
  );
}

function normalizeRepoRoot(path: string): string {
  const normalized = normalize(resolve(path));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function repoBranchKey(repoRoot: string, branch: string): string {
  return `${normalizeRepoRoot(repoRoot)}\0${branch}`;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function slug(value: string): string {
  const safe = value.replaceAll(RE_UNSAFE_SLUG, '-').replaceAll(RE_EDGE_DASHES, '');
  return (safe || 'branch').slice(0, 48);
}

function makeWorktreePath(root: string, repoRoot: string, branch: string): string {
  return join(
    root,
    `${slug(basename(repoRoot))}-${shortHash(normalizeRepoRoot(repoRoot))}`,
    `${slug(branch)}-${shortHash(branch)}`,
  );
}

function withoutBranch(options: StartOptions, cwd: string): StartOptions {
  const { branch: _branch, ...adapterOptions } = options;
  return { ...adapterOptions, cwd };
}

function gitFailure(operation: string, publicMessage: string, cause: unknown): OperationError {
  return new OperationError({ subsystem: 'git', operation, publicMessage, cause });
}

function storeEffect<A>(operation: string, publicMessage: string, run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new OperationError({ subsystem: 'store', operation, publicMessage, cause }),
  });
}
