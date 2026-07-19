import { useLinkCodeClient } from '@linkcode/client-core';
import { listAgentRuntimes } from '@linkcode/sdk';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useData } from '../runtime/tayori';

/**
 * Which agent CLIs the host can actually spawn, keyed by kind (`AgentRuntimes`); the
 * `agent-runtime.changed` push revalidates the snapshot here. Kinds the host has not evaluated
 * are absent (opencode until CODE-76).
 */
export function useAgentRuntimes() {
  const client = useLinkCodeClient();
  const result = useData(listAgentRuntimes, {});
  const { mutate } = result;

  useAbortableEffect(
    (signal) =>
      client.subscribeAgentRuntimesChanged(() => {
        if (!signal.aborted) void mutate();
      }),
    [client, mutate],
  );

  return result;
}
