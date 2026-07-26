import { useLinkCodeClient } from '@linkcode/client-core';
import type { SessionId } from '@linkcode/schema';
import { useEffect } from 'foxact/use-abortable-effect';
import type { SimulatorActivityClient } from './agent-activity';
import {
  simulatorSessionKey,
  suppressSimulatorAutoReveal,
  useSimulatorPanelStore,
} from './panel-store';

/**
 * Bring the Simulator section forward the first time an agent touches a device in `sessionId`, and
 * point the panel at that device.
 *
 * Scoped to the thread the user is looking at: an agent working a simulator in a background thread
 * must not yank the panel away from the one in front of them. Fires **once** per thread — after
 * that the panel belongs to the user, and further agent work shows up as the driving badge rather
 * than as the panel moving under their hands.
 *
 * `onReveal` is read as an effect dependency, so pass a stable callback (a store action, or any
 * function the React Compiler memoizes) to avoid needless resubscribes.
 */
export function useSimulatorAutoReveal(
  client: SimulatorActivityClient,
  sessionId: SessionId | null,
  onReveal: () => void,
): void {
  useEffect(() => {
    if (sessionId === null) return;
    return client.subscribeSimulatorActivity((activity) => {
      // Device-less tools (listing devices) name no device to reveal.
      if (activity.sessionId !== sessionId || activity.udid === undefined) return;
      if (useSimulatorPanelStore.getState().autoRevealSuppressed[sessionId]) return;
      suppressSimulatorAutoReveal(sessionId);
      useSimulatorPanelStore.getState().openDevice(simulatorSessionKey(sessionId), activity.udid);
      onReveal();
    });
  }, [client, sessionId, onReveal]);
}

/**
 * Headless mount for {@link useSimulatorAutoReveal}. The app shell renders it so the reveal works
 * while the Simulator panel itself is unmounted — which is exactly the case it exists for.
 */
export function SimulatorAutoReveal({
  sessionId,
  onReveal,
}: {
  sessionId: SessionId | null;
  onReveal: () => void;
}): null {
  useSimulatorAutoReveal(useLinkCodeClient(), sessionId, onReveal);
  return null;
}
