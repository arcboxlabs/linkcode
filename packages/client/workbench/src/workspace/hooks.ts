import { listWorkspaces } from '@linkcode/sdk';
import { useData } from '../runtime/tayori';

/**
 * Every registered workspace (directory), most recently used first. No push invalidation yet:
 * after a workspace mutation the caller must call this hook's `mutate()` — the same convention
 * `useWorkbenchSessions` follows for session mutations.
 */
export function useWorkspaces() {
  return useData(listWorkspaces, {});
}
