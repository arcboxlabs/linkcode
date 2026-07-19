import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { FileSuggestion } from '@linkcode/schema';
import { Cache, Effect } from 'effect';
import { runCommand } from '../process/run-command';

export const DEFAULT_SUGGEST_LIMIT = 50;
const MAX_ENUMERATED_FILES = 20000;
const LIST_CACHE_TTL_MS = 5000;
const LIST_CACHE_CAPACITY = 256;
const WALK_MAX_DEPTH = 8;

/** Heavy generated/vendored trees the fallback walk never descends into (the git path
 * doesn't need this — .gitignore already covers them in any sane repo). */
const WALK_IGNORED_DIRECTORY_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  'out',
  'coverage',
  'vendor',
  '__pycache__',
]);

/** Tracked + untracked-but-not-ignored, NUL-delimited. Resolves null when `cwd` is not
 * inside a git work tree (non-zero exit) or git itself is unavailable/times out. */
const listGitFiles = Effect.fn('FileSuggestService.listGitFiles')(function* (cwd: string) {
  const result = yield* runCommand(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd },
  ).pipe(Effect.catch(() => Effect.succeed(null)));
  // git missing (ENOENT) / timeout / output overrun — fall back to the walk.
  if (!result) return null;
  if (result.exitCode !== 0) return null;
  const files = result.stdout.split('\0').filter((file) => file.length > 0);
  return files.slice(0, MAX_ENUMERATED_FILES);
});

/** Bounded BFS over `cwd` for non-git workspaces: depth- and count-capped, skipping
 * hidden directories and the heavy-tree denylist. Hidden files are excluded too. */
const walkFiles = Effect.fn('FileSuggestService.walkFiles')(function* (root: string) {
  const files: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  for (let head = 0; head < queue.length && files.length < MAX_ENUMERATED_FILES; head++) {
    const { dir, depth } = queue[head];
    const entries = yield* Effect.tryPromise(() => readdir(dir, { withFileTypes: true })).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    // Unreadable directory (permissions, races) — skip, don't fail the search.
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.name[0] === '.') continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < WALK_MAX_DEPTH && !WALK_IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          queue.push({ dir: absolute, depth: depth + 1 });
        }
      } else if (entry.isFile()) {
        // `FileSuggestionSchema` promises forward-slash paths (matching `git ls-files`), but
        // `path.relative` yields the platform separator — rejoin for Windows daemons.
        files.push(path.relative(root, absolute).split(path.sep).join('/'));
        if (files.length >= MAX_ENUMERATED_FILES) break;
      }
    }
  }
  return files;
});

const listWorkspaceFiles = Effect.fn('FileSuggestService.listWorkspaceFiles')(function* (
  cwd: string,
) {
  const gitFiles = yield* listGitFiles(cwd);
  return gitFiles ?? (yield* walkFiles(cwd));
});

/**
 * Workspace file enumeration backing `file.suggest` (the composer's @-mention source) and
 * `file.list` (the Files panel's tree). Both share one TTL cache whose in-flight dedup converges
 * concurrent requests onto one enumeration. Suggest matching is substring-tiered — deliberately
 * consistent with the composer's client-side substring re-filter, so nothing the daemon returns
 * gets dropped client-side.
 */
export class FileSuggestService {
  private constructor(private readonly listCache: Cache.Cache<string, string[]>) {}

  static readonly make = (): Effect.Effect<FileSuggestService> =>
    Cache.make({
      capacity: LIST_CACHE_CAPACITY,
      lookup: listWorkspaceFiles,
      timeToLive: LIST_CACHE_TTL_MS,
    }).pipe(Effect.map((listCache) => new FileSuggestService(listCache)));

  /** Every workspace file under `cwd`, cwd-relative. Unranked, in enumeration order. */
  list(cwd: string): Effect.Effect<string[]> {
    return Cache.get(this.listCache, cwd);
  }

  /** Search the workspace under `cwd` for files matching `query` (empty = browse mode:
   * everything matches, shallow files first). Returned paths are cwd-relative. */
  suggest(
    cwd: string,
    query: string,
    limit = DEFAULT_SUGGEST_LIMIT,
  ): Effect.Effect<FileSuggestion[]> {
    return this.list(cwd).pipe(
      Effect.map((files) =>
        rankFiles(files, query)
          .slice(0, limit)
          .map((file) => ({ path: file })),
      ),
    );
  }
}

/** Match tiers, best first: basename equals → starts-with → contains → full path contains.
 * Ties order by path depth then locale compare, so an empty query reads as a shallow-first
 * browse listing. */
function rankFiles(files: readonly string[], query: string): string[] {
  const needle = query.toLowerCase();
  const ranked: Array<{ file: string; tier: number; depth: number }> = [];
  for (const file of files) {
    const tier = matchTier(file, needle);
    if (tier === null) continue;
    ranked.push({ file, tier, depth: file.split('/').length });
  }
  ranked.sort((a, b) => a.tier - b.tier || a.depth - b.depth || a.file.localeCompare(b.file));
  return ranked.map((entry) => entry.file);
}

function matchTier(file: string, needle: string): number | null {
  if (needle.length === 0) return 3;
  const basename = file.slice(file.lastIndexOf('/') + 1).toLowerCase();
  if (basename === needle) return 0;
  if (basename.startsWith(needle)) return 1;
  if (basename.includes(needle)) return 2;
  if (file.toLowerCase().includes(needle)) return 3;
  return null;
}
