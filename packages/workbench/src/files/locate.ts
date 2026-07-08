import type { Conversation } from '@linkcode/client-core';
import { readWorkspaceFile } from '@linkcode/sdk';

/** Probing is bounded: candidates beyond this are dropped (dirs are deduped first). */
const MAX_CANDIDATES = 8;

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
  if (requestPath[0] === '/') return [requestPath];

  const suffix = `/${requestPath}`;
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
      if (touched[0] !== '/') continue;
      if (touched.endsWith(suffix)) exactHits.push(touched);
      const dir = touched.slice(0, touched.lastIndexOf('/'));
      if (dir) touchedDirs.push(dir);
    }
  }

  // Later tool calls are likelier to concern the clicked file — probe newest first.
  exactHits.reverse();
  touchedDirs.reverse();
  const candidates = new Set<string>([
    ...exactHits,
    `${cwd}${suffix}`,
    ...touchedDirs.map((dir) => `${dir}${suffix}`),
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
