import type { Conversation } from '@linkcode/client-core';
import { readWorkspaceFile } from '@linkcode/sdk';
import { dirname, isAbsolute, join, normalize } from 'pathe';

/** Probing is bounded: candidates beyond this are dropped (dirs are deduped first). */
const MAX_CANDIDATES = 8;

/** Path predicates/joins go through `pathe`: the daemon may sit on either platform
 * (POSIX `/`, Windows drive or UNC), and pathe recognizes all of them while
 * normalizing output to forward slashes — which win32 Node accepts as-is. */
export { isAbsolute as isAbsoluteFilePath } from 'pathe';

/**
 * Absolute paths a clicked file reference may resolve to, most likely first.
 * A bare `qingjia.pdf` in agent prose carries no directory, and the agent may have
 * worked outside the session cwd — so candidates come from the conversation's
 * tool-call locations (exact basename hits first, then their directories), with the
 * cwd anchor between them. Pure; exported for tests.
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
 * Resolve a clicked file reference to the absolute path to open: the first candidate
 * the daemon can actually read wins; when none reads (or there is nothing to probe),
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
        await readWorkspaceFile({ cwd, path: candidate });
        return candidate;
      } catch {
        // Unreadable candidate — try the next; the viewer reports the final failure.
      }
    }
  }
  return candidates[0];
}
