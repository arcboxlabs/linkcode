import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { basename, join, normalize, resolve } from 'node:path';
import type { SessionId, StartOptions, WorktreeRecord } from '@linkcode/schema';
import { SessionIdSchema } from '@linkcode/schema';
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
} from '../git/worktrees';
import type { WorktreeStore } from './worktree-store';

const RE_UNSAFE_SLUG = /[^\w.-]+/g;
const RE_EDGE_DASHES = /^-+|-+$/g;
const RE_CHECKED_OUT = /already checked out|already used by worktree/i;

export class WorktreeService {
  private readonly bySession = new Map<SessionId, WorktreeRecord>();
  private readonly byRepoBranch = new Map<string, WorktreeRecord>();
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
      Effect.tap((records) =>
        Effect.sync(() => {
          for (const record of records) {
            this.bySession.set(record.sessionId, record);
            this.byRepoBranch.set(repoBranchKey(record.repoRoot, record.branch), record);
          }
        }),
      ),
      Effect.andThen(Effect.suspend(() => this.reconcile(durableSessionIds))),
    );
  }

  provision(
    options: StartOptions,
    sessionId: SessionId,
  ): Effect.Effect<StartOptions, EngineFailure> {
    if (!options.branch) return Effect.succeed(options);
    const branch = options.branch.name;
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
        this.provisionLocked(options, sessionId, repoRoot, branch),
      );
    });
  }

  verifyResume(sessionId: SessionId): Effect.Effect<void, RequestError> {
    const record = this.bySession.get(sessionId);
    if (!record || existsSync(record.worktreePath)) return Effect.void;
    return Effect.fail(
      new RequestError({
        code: 'worktree_missing',
        message: `The managed worktree is missing at ${record.worktreePath}. Restore it or delete this session.`,
      }),
    );
  }

  get(sessionId: SessionId): WorktreeRecord | undefined {
    return this.bySession.get(sessionId);
  }

  hasPath(path: string): boolean {
    const key = normalizeRepoRoot(path);
    return [...this.bySession.values()].some(
      (record) => normalizeRepoRoot(record.worktreePath) === key,
    );
  }

  cleanupDeletedSession(sessionId: SessionId): Effect.Effect<void, OperationError> {
    const record = this.bySession.get(sessionId);
    if (!record) return Effect.void;
    return this.semaphore(normalizeRepoRoot(record.repoRoot)).withPermit(
      this.cleanupRecord(record),
    );
  }

  provisionLocked(
    options: StartOptions,
    sessionId: SessionId,
    repoRoot: string,
    branch: string,
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
      if (current === branch) return withoutBranch(options, options.cwd);
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
        sessionId,
        createdAt: Date.now(),
        state: 'active',
      };
      const saved = yield* Effect.exit(
        storeEffect('worktrees.save', 'Failed to persist managed worktree', () =>
          this.store.save(record),
        ),
      );
      if (Exit.isFailure(saved)) {
        yield* removeWorktreeBestEffort(repoRoot, worktreePath);
        return yield* Effect.failCause(saved.cause);
      }
      this.bySession.set(sessionId, record);
      this.byRepoBranch.set(repoBranchKey(repoRoot, branch), record);
      yield* this.git.invalidate(options.cwd);
      yield* this.git.invalidate(worktreePath);
      return withoutBranch(options, worktreePath);
    });
  }

  semaphore(repoRoot: string): Semaphore.Semaphore {
    const existing = this.semaphores.get(repoRoot);
    if (existing) return existing;
    const semaphore = Semaphore.makeUnsafe(1);
    this.semaphores.set(repoRoot, semaphore);
    return semaphore;
  }

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

  reconcile(sessionIds: ReadonlySet<SessionId>): Effect.Effect<void, OperationError> {
    return Effect.gen({ self: this }, function* () {
      for (const record of this.bySession.values()) {
        const hasSession = sessionIds.has(record.sessionId);
        if (!existsSync(record.worktreePath)) {
          yield* this.semaphore(normalizeRepoRoot(record.repoRoot)).withPermit(
            (hasSession
              ? this.pruneAdvisory(record.repoRoot).pipe(Effect.andThen(this.markOrphaned(record)))
              : this.cleanupRecord(record)
            ).pipe(
              Effect.catch((error) =>
                Effect.logWarning('Managed worktree reconciliation deferred', error),
              ),
            ),
          );
        } else if (!hasSession && record.state === 'active') {
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

  scanUnknown(): Effect.Effect<void> {
    if (!this.root || !existsSync(this.root)) return Effect.void;
    const root = this.root;
    return Effect.gen({ self: this }, function* () {
      const groups = yield* readChildDirectories(root);
      for (const group of groups) {
        const candidates = yield* readChildDirectories(group);
        for (const candidate of candidates) {
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
            sessionId: orphanSessionId(candidate),
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
          this.bySession.delete(record.sessionId);
          this.byRepoBranch.delete(repoBranchKey(record.repoRoot, record.branch));
        }),
      ),
      Effect.asVoid,
    );
  }

  private index(record: WorktreeRecord): void {
    this.bySession.set(record.sessionId, record);
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

function orphanSessionId(path: string): SessionId {
  const digest = createHash('sha256').update(normalizeRepoRoot(path)).digest('hex');
  return SessionIdSchema.parse(`orphan-worktree-${digest}`);
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
