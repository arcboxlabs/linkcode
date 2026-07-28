import { readWorkspaceFile } from '@linkcode/sdk';
import { useData } from '../runtime/tayori';

/**
 * A workspace file's content for the panel viewers, keyed by (cwd, path) so sessions in the same
 * directory share one cache entry. No polling — read on open; `mutate()` refreshes.
 */
export function useWorkspaceFile(cwd: string | undefined, path: string | null) {
  return useData(readWorkspaceFile, cwd === undefined || path === null ? null : { cwd, path }, {
    keepPreviousData: true,
  });
}
