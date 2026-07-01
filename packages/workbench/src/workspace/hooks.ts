import { listWorkspaces } from '@linkcode/sdk';
import { useData } from '../runtime/tayori';

/**
 * Every registered workspace (directory), most recently used first. There is no push
 * invalidation yet: mutating a workspace (`registerWorkspace` / `updateWorkspace` /
 * `archiveWorkspace`, called directly from `@linkcode/sdk` at the call site) is the caller's cue
 * to revalidate — call this hook's `mutate()` after the mutation resolves, the same convention
 * `useWorkbenchSessions` follows for session mutations.
 */
export function useWorkspaces() {
  return useData(listWorkspaces, {});
}
