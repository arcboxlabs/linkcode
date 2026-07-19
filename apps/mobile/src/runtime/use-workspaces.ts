import { useLinkCodeClient } from '@linkcode/client-core';
import type { WorkspaceRecord } from '@linkcode/schema';
import { noop } from 'foxact/noop';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useCallback, useState } from 'react';

/** The host's registered workspaces (projects). A failed initial load degrades to the
 * unregistered fallback group — sessions still render; `refresh` rethrows for pull-to-refresh. */
export function useWorkspaces(): {
  workspaces: WorkspaceRecord[];
  refresh: () => Promise<void>;
} {
  const client = useLinkCodeClient();
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const load = useCallback(() => client.listWorkspaces(), [client]);

  useAbortableEffect(
    (signal) => {
      void load()
        .then((next) => {
          if (!signal.aborted) setWorkspaces(next);
        })
        .catch(noop);
    },
    [load],
  );

  const refresh = useCallback(async () => {
    setWorkspaces(await load());
  }, [load]);

  return { workspaces, refresh };
}
