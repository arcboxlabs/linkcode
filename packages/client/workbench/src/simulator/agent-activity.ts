import type { LinkCodeClient } from '@linkcode/client-core';
import { useEffect } from 'foxact/use-abortable-effect';
import { useState } from 'react';

/** The slice of `LinkCodeClient` the activity hook needs. */
export type SimulatorActivityClient = Pick<LinkCodeClient, 'subscribeSimulatorActivity'>;

/** How long the indicator lingers after the last tool settles. Agents drive a device as a burst of
 * short calls, so clearing instantly would strobe the badge between consecutive taps. */
const LINGER_MS = 1200;

/** How long the pointer stays on the last spot an agent touched. Long enough to be seen between
 * calls in a burst, short enough that it does not linger over a screen the agent has moved on from. */
const POINTER_MS = 2000;

/** What the panel knows about an agent driving this device. */
export interface SimulatorAgentActivity {
  /** An agent tool is in flight (or just settled) on this device. */
  active: boolean;
  /** The last point an agent acted on, normalized 0..1, or `null` when nothing recent. */
  point: { x: number; y: number } | null;
}

/**
 * Whether an agent is currently driving `udid` and where it last touched, from the daemon's
 * `simulator.activity` broadcast. That feed originates only in the built-in simulator MCP server,
 * so it is agent activity by construction — the user's own taps in this panel never raise it.
 */
export function useSimulatorAgentActivity(
  client: SimulatorActivityClient,
  udid: string | null,
): SimulatorAgentActivity {
  const [active, setActive] = useState(false);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (udid === null) return;
    // Tools can overlap, so track depth rather than a boolean: the badge clears on the *last*
    // settle, not the first. Every started is paired with a settled in a `finally`, so this
    // cannot leak a permanently-lit badge.
    let inflight = 0;
    let clearTimer: ReturnType<typeof setTimeout> | undefined;
    let pointTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = client.subscribeSimulatorActivity((activity) => {
      // Device-less tools (listing devices, probing) are not "driving this device".
      if (activity.udid !== udid) return;
      // Only the pointer tools carry a point; everything else leaves the last one alone rather
      // than clearing it, so a screenshot between two taps does not blink the pointer away.
      if (activity.x !== undefined && activity.y !== undefined) {
        const at = { x: activity.x, y: activity.y };
        setPoint(at);
        clearTimeout(pointTimer);
        pointTimer = setTimeout(setPoint, POINTER_MS, null);
      }
      if (activity.phase === 'started') {
        inflight += 1;
        clearTimeout(clearTimer);
        setActive(true);
        return;
      }
      inflight = Math.max(0, inflight - 1);
      if (inflight === 0) {
        clearTimeout(clearTimer);
        clearTimer = setTimeout(setActive, LINGER_MS, false);
      }
    });
    return () => {
      unsubscribe();
      clearTimeout(clearTimer);
      clearTimeout(pointTimer);
      setActive(false);
      setPoint(null);
    };
  }, [client, udid]);

  return { active, point };
}
