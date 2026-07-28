import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitDiff, GitDiffMode, GitDiffStat } from '@linkcode/schema';
import { Data, Effect } from 'effect';
import { runCommand } from '../process/run-command';

/** Read-only git env: never prompt for credentials, never take optional locks — a diff read must
 * not contend with a concurrently running agent's git for `index.lock`. */
const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } as const;

/** Cap the assembled patch so one huge diff can't blow up the wire message or the viewer. */
const PATCH_BYTE_CAP = 2 * 1024 * 1024;
/** Cap on untracked files folded into an `uncommitted` diff — a directory full of build output
 * shouldn't diff hundreds of files one at a time. */
const MAX_UNTRACKED_FILES = 200;
/** Bytes read from the head of an untracked file to decide binary-ness — mirrors git's own
 * heuristic without loading a large binary blob into memory or a diff subprocess. */
const BINARY_PROBE_BYTES = 8192;

class GitDiffError extends Data.TaggedError('GitDiffError')<{
  readonly operation: 'base_ref' | 'merge_base' | 'file_open' | 'file_read' | 'file_close';
  readonly cause?: unknown;
}> {}

const git = Effect.fn('Git.diffCommand')(function* (cwd: string, ...args: string[]) {
  return yield* runCommand('git', args, { cwd, env: GIT_ENV });
});

const readUncommittedTrackedDiff = Effect.fn('Git.readUncommittedTrackedDiff')(function* (
  cwd: string,
) {
  const withHead = yield* git(cwd, 'diff', 'HEAD');
  if (withHead.exitCode === 0) return withHead.stdout;
  // No HEAD yet (a fresh, empty repo) — there is nothing to diff against, so fall back to the
  // plain working-tree diff instead of surfacing "unknown revision" as a request failure.
  const noHead = yield* git(cwd, 'diff');
  return noHead.exitCode === 0 ? noHead.stdout : '';
});

const REMOTES_REF_PREFIX = /^refs\/remotes\//;

/** Resolve the remote's default branch: the local `origin/HEAD` symref, falling back to probing
 * for `origin/main` then `origin/master`. */
const resolveBaseRef = Effect.fn('Git.resolveBaseRef')(function* (cwd: string) {
  const symref = yield* git(cwd, 'symbolic-ref', 'refs/remotes/origin/HEAD');
  if (symref.exitCode === 0) {
    const base = symref.stdout.trim().replace(REMOTES_REF_PREFIX, '');
    if (base.length > 0) return base;
  }
  for (const candidate of ['origin/main', 'origin/master']) {
    const verify = yield* git(cwd, 'rev-parse', '--verify', '--quiet', `refs/remotes/${candidate}`);
    if (verify.exitCode === 0) return candidate;
  }
  return yield* Effect.fail(new GitDiffError({ operation: 'base_ref' }));
});

const readBaseDiff = Effect.fn('Git.readBaseDiff')(function* (cwd: string) {
  const base = yield* resolveBaseRef(cwd);
  const mergeBase = yield* git(cwd, 'merge-base', 'HEAD', base);
  const mergeBaseSha = mergeBase.stdout.trim();
  if (mergeBase.exitCode !== 0 || mergeBaseSha.length === 0) {
    return yield* Effect.fail(new GitDiffError({ operation: 'merge_base' }));
  }
  const diff = yield* git(cwd, 'diff', mergeBaseSha);
  return diff.exitCode === 0 ? diff.stdout : '';
});

const looksBinary = Effect.fn('Git.looksBinary')(function* (absPath: string) {
  return yield* Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => open(absPath, 'r'),
      catch: (cause) => new GitDiffError({ operation: 'file_open', cause }),
    }).pipe(Effect.catch(() => Effect.succeed(null))),
    (handle) => {
      if (!handle) return Effect.succeed(false);
      const buffer = Buffer.alloc(BINARY_PROBE_BYTES);
      return Effect.tryPromise({
        try: () => handle.read(buffer, 0, BINARY_PROBE_BYTES, 0),
        catch: (cause) => new GitDiffError({ operation: 'file_read', cause }),
      }).pipe(
        Effect.map(({ bytesRead }) => buffer.subarray(0, bytesRead).includes(0)),
        Effect.catch(() => Effect.succeed(false)),
      );
    },
    (handle) =>
      handle
        ? Effect.tryPromise({
            try: () => handle.close(),
            catch: (cause) => new GitDiffError({ operation: 'file_close', cause }),
          })
        : Effect.void,
  );
});

const readUntrackedFileDiff = Effect.fn('Git.readUntrackedFileDiff')(function* (
  cwd: string,
  relPath: string,
) {
  if (yield* looksBinary(join(cwd, relPath))) {
    return [
      `diff --git a/${relPath} b/${relPath}`,
      'new file mode 100644',
      `Binary files /dev/null and b/${relPath} differ`,
      '',
    ].join('\n');
  }
  const diff = yield* git(cwd, 'diff', '--no-index', '--', '/dev/null', relPath);
  // `--no-index` exits 1 when the two sides differ, which is the expected outcome here; only a
  // higher exit code (spawn/usage error) means the file couldn't be diffed at all.
  return diff.exitCode <= 1 ? diff.stdout : null;
});

const readUntrackedDiff = Effect.fn('Git.readUntrackedDiff')(function* (cwd: string) {
  const status = yield* git(cwd, 'status', '--porcelain', '-z');
  if (status.exitCode !== 0) return { patch: '', truncated: false };

  const paths: string[] = [];
  for (const entry of status.stdout.split('\0')) {
    if (entry.startsWith('?? ')) paths.push(entry.slice(3));
  }
  const truncated = paths.length > MAX_UNTRACKED_FILES;
  const parts = yield* Effect.forEach(paths.slice(0, MAX_UNTRACKED_FILES), (relPath) =>
    readUntrackedFileDiff(cwd, relPath),
  );
  return { patch: joinPatchParts(parts.filter((part) => part !== null)), truncated };
});

/** Read a unified-diff patch. `'uncommitted'` = working tree (tracked + untracked) vs HEAD;
 * `'base'` = HEAD vs merge-base with the remote default branch, never including untracked files. */
export const readGitDiff = Effect.fn('Git.readDiff')(function* (cwd: string, mode: GitDiffMode) {
  const tracked =
    mode === 'uncommitted' ? yield* readUncommittedTrackedDiff(cwd) : yield* readBaseDiff(cwd);
  const untracked = mode === 'uncommitted' ? yield* readUntrackedDiff(cwd) : null;

  const combined = joinPatchParts([tracked, untracked?.patch ?? '']);
  const { patch, truncated: sizeTruncated } = capToFileBoundary(combined, PATCH_BYTE_CAP);
  return {
    patch,
    truncated: sizeTruncated || (untracked?.truncated ?? false),
    stat: computeStat(patch),
  } satisfies GitDiff;
});

function joinPatchParts(parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join('');
}

/** Byte offsets of every `diff --git ` file-header line, in order; a fresh patch's first file
 * always starts at offset 0. */
function findFileBoundaries(patch: string): number[] {
  const marker = 'diff --git ';
  const boundaries: number[] = [];
  let index = patch.indexOf(marker);
  while (index !== -1) {
    if (index === 0 || patch[index - 1] === '\n') boundaries.push(index);
    index = patch.indexOf(marker, index + marker.length);
  }
  return boundaries;
}

/** Cut a patch down to the cap at the last complete file boundary — never mid-file. */
function capToFileBoundary(patch: string, capBytes: number): { patch: string; truncated: boolean } {
  if (Buffer.byteLength(patch, 'utf8') <= capBytes) return { patch, truncated: false };

  const fileEnds = [...findFileBoundaries(patch).slice(1), patch.length];
  let cut = 0;
  for (const end of fileEnds) {
    if (Buffer.byteLength(patch.slice(0, end), 'utf8') > capBytes) break;
    cut = end;
  }
  return { patch: patch.slice(0, cut), truncated: true };
}

/** Derive file/addition/deletion counts straight from the assembled patch text. */
function computeStat(patch: string): GitDiffStat {
  let files = 0;
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) files += 1;
    else if (line.startsWith('+++') || line.startsWith('---')) continue;
    else if (line[0] === '+') additions += 1;
    else if (line[0] === '-') deletions += 1;
  }
  return { files, additions, deletions };
}
