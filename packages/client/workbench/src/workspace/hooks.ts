import { listWorkspaces } from '@linkcode/sdk';
import { useData } from '../runtime/tayori';

/**
 * Every registered workspace (directory), most recently used first. The runtime revalidates it on
 * every `session.changed` push (the daemon registers/freshens a session's workspace as part of
 * start/resume/import); a workspace mutation this client issues itself still calls `mutate()` —
 * the same convention `useWorkbenchSessions` follows for session mutations.
 */
export function useWorkspaces() {
  return useData(listWorkspaces, {});
}
