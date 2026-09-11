import { listWorkspaces } from '@linkcode/sdk';
import { useData } from '../runtime/tayori';

/**
 * Every registered workspace (directory), most recently used first. The runtime revalidates it on
 * every `session.changed` push, which covers a session another client starts or resumes: the daemon
 * registers that workspace before announcing the record. It does not cover an import of a
 * brand-new cwd (announced before the touch) or another client's explicit register/rename/archive,
 * which have no push at all. A workspace mutation this client issues itself still calls `mutate()`,
 * the same convention `useWorkbenchSessions` follows for session mutations.
 */
export function useWorkspaces() {
  return useData(listWorkspaces, {});
}
