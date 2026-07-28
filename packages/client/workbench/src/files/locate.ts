import type { Conversation } from '@linkcode/client-core';
import { readWorkspaceFile } from '@linkcode/sdk';
import { isErrorLikeObject } from 'foxts/extract-error-message';
import { dirname, isAbsolute, join, normalize } from 'pathe';

/** Probing is bounded: candidates beyond this are dropped (dirs are deduped first). */
const MAX_CANDIDATES = 8;

/** Path predicates/joins go through `pathe`: the daemon may sit on either platform (POSIX,
 * Windows drive/UNC), and pathe normalizes output to forward slashes, which win32 Node accepts. */
export { isAbsolute as isAbsoluteFilePath } from 'pathe';

/**
 * Absolute paths a clicked file reference may resolve to, most likely first: a bare filename may
 * live outside the session cwd, so candidates come from the conversation's tool-call locations
 * (exact basename hits, then their directories) with the cwd anchor between. Pure; exported for tests.
 */
export function fileArtifactCandidates(
  requestPath: string,
  cwd: string,
  items: Conversation['items'],
): string[] {
  if (isAbsolute(requestPath)) return [requestPath];

  const relative = normalize(requestPath);
  const suffix = `/${relative}`;
  const exactHits: string[] = [];
  const touchedDirs: string[] = [];
  for (const item of items) {
    if (item.kind !== 'tool') continue;
    const paths = (item.toolCall.locations ?? []).map((location) => location.path);
    for (const content of item.toolCall.content) {
      if (content.type === 'diff') paths.push(content.path);
    }
    for (const touched of paths) {
      // Relative locations (adapter-dependent) have no reliable anchor; skip them.
      if (!isAbsolute(touched)) continue;
      const normalized = normalize(touched);
      if (normalized.endsWith(suffix)) exactHits.push(normalized);
      touchedDirs.push(dirname(normalized));
    }
  }

  // Later tool calls are likelier to concern the clicked file — probe newest first.
  exactHits.reverse();
  touchedDirs.reverse();
  const candidates = new Set<string>([
    ...exactHits,
    join(cwd, relative),
    ...touchedDirs.map((dir) => join(dir, relative)),
  ]);
  return [...candidates].slice(0, MAX_CANDIDATES);
}

/**
 * Resolve a clicked file reference: the first candidate the daemon confirms as a regular file
 * wins. The read-size cap still proves an oversized candidate exists; when none can be verified,
 * fall back to the most likely candidate so the viewer surfaces the read error.
 */
export async function locateFileArtifact(
  requestPath: string,
  cwd: string,
  items: Conversation['items'],
): Promise<string> {
  const candidates = fileArtifactCandidates(requestPath, cwd, items);
  if (candidates.length > 1) {
    for (const candidate of candidates) {
      try {
        // eslint-disable-next-line no-await-in-loop -- candidates must be probed in priority order and stop at the first readable path.
        await readWorkspaceFile({ cwd, path: candidate });
        return candidate;
      } catch (error) {
        if (isErrorLikeObject(error) && 'code' in error && error.code === 'limit_exceeded') {
          // file.read verifies the candidate is a regular file before enforcing its size cap.
          return candidate;
        }
        // Unreadable candidate — try the next; the viewer reports the final failure.
      }
    }
  }
  return candidates[0];
}
