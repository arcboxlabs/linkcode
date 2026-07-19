import { useLinkCodeClient } from '@linkcode/client-core';
import { normalizeCwdKey } from '@linkcode/schema';
import { listWorkspaceScripts } from '@linkcode/sdk';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useData } from '../runtime/tayori';

/**
 * The workspace's declared scripts with live lifecycle/health. The list is a cheap RPC, so
 * `script.status` broadcasts simply revalidate it instead of merging patches client-side.
 */
export function useWorkspaceScripts(cwd: string | undefined) {
  const client = useLinkCodeClient();
  const result = useData(listWorkspaceScripts, cwd === undefined ? null : { cwd }, {
    keepPreviousData: true,
  });
  const { mutate } = result;

  useAbortableEffect(
    (signal) => {
      if (cwd === undefined) return;
      const key = normalizeCwdKey(cwd);

      return client.subscribeScriptStatus((statusCwd) => {
        if (normalizeCwdKey(statusCwd) === key && !signal.aborted) void mutate();
      });
    },
    [client, cwd, mutate],
  );

  return result;
}
