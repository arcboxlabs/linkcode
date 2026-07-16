import type { FileHandle } from 'node:fs/promises';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitDiff, GitDiffMode, GitDiffStat } from '@linkcode/schema';
import { runCommand } from './exec';

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

function git(cwd: string, ...args: string[]): Promise<{ stdout: string; exitCode: number }> {
  return runCommand('git', args, { cwd, env: GIT_ENV });
}

/** Read a unified-diff patch. `'uncommitted'` = working tree (tracked + untracked) vs HEAD;
 * `'base'` = HEAD vs merge-base with the remote default branch, never including untracked files. */
export async function readGitDiff(cwd: string, mode: GitDiffMode): Promise<GitDiff> {
  const tracked =
    mode === 'uncommitted' ? await readUncommittedTrackedDiff(cwd) : await readBaseDiff(cwd);
  const untracked = mode === 'uncommitted' ? await readUntrackedDiff(cwd) : null;

  const combined = joinPatchParts([tracked, untracked?.patch ?? '']);
  const { patch, truncated: sizeTruncated } = capToFileBoundary(combined, PATCH_BYTE_CAP);
  return {
    patch,
    truncated: sizeTruncated || (untracked?.truncated ?? false),
    stat: computeStat(patch),
  };
}

async function readUncommittedTrackedDiff(cwd: string): Promise<string> {
  const withHead = await git(cwd, 'diff', 'HEAD');
  if (withHead.exitCode === 0) return withHead.stdout;
  // No HEAD yet (a fresh, empty repo) — there is nothing to diff against, so fall back to the
  // plain working-tree diff instead of surfacing "unknown revision" as a request failure.
  const noHead = await git(cwd, 'diff');
  return noHead.exitCode === 0 ? noHead.stdout : '';
}

async function readBaseDiff(cwd: string): Promise<string> {
  const base = await resolveBaseRef(cwd);
  const mergeBase = await git(cwd, 'merge-base', 'HEAD', base);
  const mergeBaseSha = mergeBase.stdout.trim();
  if (mergeBase.exitCode !== 0 || mergeBaseSha.length === 0) {
    throw new Error(`Could not find a merge base between HEAD and ${base} in ${cwd}`);
  }
  const diff = await git(cwd, 'diff', mergeBaseSha);
  return diff.exitCode === 0 ? diff.stdout : '';
}

const REMOTES_REF_PREFIX = /^refs\/remotes\//;

/** Resolve the remote's default branch: the local `origin/HEAD` symref, falling back to probing
 * for `origin/main` then `origin/master`. */
async function resolveBaseRef(cwd: string): Promise<string> {
  const symref = await git(cwd, 'symbolic-ref', 'refs/remotes/origin/HEAD');
  if (symref.exitCode === 0) {
    const base = symref.stdout.trim().replace(REMOTES_REF_PREFIX, '');
    if (base.length > 0) return base;
  }
  for (const candidate of ['origin/main', 'origin/master']) {
    // eslint-disable-next-line no-await-in-loop -- candidates are a precedence list; the first hit wins
    const verify = await git(cwd, 'rev-parse', '--verify', '--quiet', `refs/remotes/${candidate}`);
    if (verify.exitCode === 0) return candidate;
  }
  throw new Error(`Could not resolve a base branch to diff against in ${cwd}`);
}

async function readUntrackedDiff(cwd: string): Promise<{ patch: string; truncated: boolean }> {
  const status = await git(cwd, 'status', '--porcelain', '-z');
  if (status.exitCode !== 0) return { patch: '', truncated: false };

  const paths: string[] = [];
  for (const entry of status.stdout.split('\0')) {
    if (entry.startsWith('?? ')) paths.push(entry.slice(3));
  }
  const truncated = paths.length > MAX_UNTRACKED_FILES;
  const capped = paths.slice(0, MAX_UNTRACKED_FILES);

  const parts: string[] = [];
  for (const relPath of capped) {
    // eslint-disable-next-line no-await-in-loop -- one git subprocess at a time: up to 200 files; unbounded concurrent spawns would thrash
    const part = await readUntrackedFileDiff(cwd, relPath);
    if (part) parts.push(part);
  }
  return { patch: joinPatchParts(parts), truncated };
}

async function readUntrackedFileDiff(cwd: string, relPath: string): Promise<string | null> {
  if (await looksBinary(join(cwd, relPath))) {
    return [
      `diff --git a/${relPath} b/${relPath}`,
      'new file mode 100644',
      `Binary files /dev/null and b/${relPath} differ`,
      '',
    ].join('\n');
  }
  const diff = await git(cwd, 'diff', '--no-index', '--', '/dev/null', relPath);
  // `--no-index` exits 1 when the two sides differ, which is the expected outcome here; only a
  // higher exit code (spawn/usage error) means the file couldn't be diffed at all.
  return diff.exitCode <= 1 ? diff.stdout : null;
}

/** Read only the head of the file — cheap even for a multi-gigabyte binary blob. */
async function looksBinary(absPath: string): Promise<boolean> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(absPath, 'r');
    const buffer = Buffer.alloc(BINARY_PROBE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, BINARY_PROBE_BYTES, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } catch {
    // Unreadable (permissions, vanished mid-scan) — fall through to `git diff --no-index`, which
    // will report the failure on its own terms.
    return false;
  } finally {
    await handle?.close();
  }
}

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
