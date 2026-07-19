import { listWorkspaceFiles, readWorkspaceFile } from '@linkcode/sdk';
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

/**
 * Every workspace file path for the Files tree, keyed by cwd. No polling and no
 * keepPreviousData — a cwd switch must not paint the previous workspace's tree.
 */
export function useWorkspaceFileList(cwd: string | undefined) {
  return useData(listWorkspaceFiles, cwd === undefined ? null : { cwd });
}
