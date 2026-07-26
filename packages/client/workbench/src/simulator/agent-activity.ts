import type { LinkCodeClient } from '@linkcode/client-core';
import { useEffect } from 'foxact/use-abortable-effect';
import { useState } from 'react';

/** The slice of `LinkCodeClient` the activity hook needs. */
export type SimulatorActivityClient = Pick<LinkCodeClient, 'subscribeSimulatorActivity'>;

/** How long the indicator lingers after the last tool settles. Agents drive a device as a burst of
 * short calls, so clearing instantly would strobe the badge between consecutive taps. */
const LINGER_MS = 1200;

/**
 * Whether an agent is currently driving `udid`, from the daemon's `simulator.activity` broadcast.
 * That feed originates only in the built-in simulator MCP server, so it is agent activity by
 * construction — the user's own taps in this panel never raise it.
 */
export function useSimulatorAgentActivity(
  client: SimulatorActivityClient,
  udid: string | null,
): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (udid === null) return;
    // Tools can overlap, so track depth rather than a boolean: the badge clears on the *last*
    // settle, not the first. Every started is paired with a settled in a `finally`, so this
    // cannot leak a permanently-lit badge.
    let inflight = 0;
    let clearTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = client.subscribeSimulatorActivity((activity) => {
      // Device-less tools (listing devices, probing) are not "driving this device".
      if (activity.udid !== udid) return;
      if (activity.phase === 'started') {
        inflight += 1;
        clearTimeout(clearTimer);
        setActive(true);
        return;
      }
      inflight = Math.max(0, inflight - 1);
      if (inflight === 0) {
        clearTimeout(clearTimer);
        clearTimer = setTimeout(() => setActive(false), LINGER_MS);
      }
    });
    return () => {
      unsubscribe();
      clearTimeout(clearTimer);
      setActive(false);
    };
  }, [client, udid]);

  return active;
}
