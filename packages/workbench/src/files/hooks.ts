import { readWorkspaceFile } from '@linkcode/sdk';
import { useData } from '../runtime/tayori';

/**
 * A workspace file's content for the panel viewers. Keyed by (cwd, path), so two
 * sessions in the same directory share one cache entry. No polling: file artifacts are
 * read on open; `mutate()` refreshes when a viewer wants a newer snapshot.
 */
export function useWorkspaceFile(cwd: string | undefined, path: string | null) {
  return useData(readWorkspaceFile, cwd === undefined || path === null ? null : { cwd, path }, {
    keepPreviousData: true,
  });
}
