import type { LinkCodeClient } from '@linkcode/client-core';
import type { SimulatorConsentDecision, SimulatorConsentState } from '@linkcode/schema';
import { useEffect } from 'foxact/use-abortable-effect';
import { noop } from 'foxts/noop';
import { useState } from 'react';

/** The slice of `LinkCodeClient` the consent hooks need. */
export type SimulatorConsentClient = Pick<
  LinkCodeClient,
  | 'simulatorConsentGet'
  | 'simulatorConsentSet'
  | 'simulatorConsentSetAgentTools'
  | 'subscribeSimulatorConsentChanged'
  | 'subscribeSimulatorConsentRequired'
>;

const EMPTY: SimulatorConsentState = { entries: [], agentToolsEnabled: true };

export interface SimulatorConsent {
  /** `undefined` = never asked; the next agent tool call on that device raises a prompt. */
  decisionFor: (udid: string) => SimulatorConsentDecision | undefined;
  agentToolsEnabled: boolean;
  /** Pass `undefined` to forget a decision, so the agent asks again next time. */
  decide: (udid: string, decision?: SimulatorConsentDecision) => void;
  setAgentToolsEnabled: (enabled: boolean) => void;
}

/**
 * Per-device agent consent (CODE-420), read from the host and kept live by its change broadcast.
 * Writes go straight to the host — the broadcast is what updates this state, so every client
 * showing the same device agrees rather than drifting on optimistic local edits.
 */
export function useSimulatorConsent(client: SimulatorConsentClient): SimulatorConsent {
  const [state, setState] = useState<SimulatorConsentState>(EMPTY);

  useEffect(
    (signal) => {
      void client
        .simulatorConsentGet()
        .then((next) => {
          if (!signal.aborted) setState(next);
        })
        // A host with no simulator surface answers nothing; "never asked" is the right default.
        .catch(noop);
      return client.subscribeSimulatorConsentChanged(setState);
    },
    [client],
  );

  return {
    decisionFor: (udid) => state.entries.find((entry) => entry.udid === udid)?.decision,
    agentToolsEnabled: state.agentToolsEnabled,
    // A rejected write produces no broadcast, so this state simply stays as it was — which is
    // the honest outcome, since nothing changed on the host either.
    decide(udid, decision) {
      void client.simulatorConsentSet(udid, decision).catch(noop);
    },
    setAgentToolsEnabled(enabled) {
      void client.simulatorConsentSetAgentTools(enabled).catch(noop);
    },
  };
}

/**
 * The device an agent is currently suspended on, waiting for a decision — `null` when nothing is
 * pending. Cleared as soon as any decision for that device lands, whoever made it.
 */
export function useSimulatorConsentRequest(
  client: SimulatorConsentClient,
): { udid: string; tool: string } | null {
  const [request, setRequest] = useState<{ udid: string; tool: string } | null>(null);

  useEffect(() => {
    const unsubscribeRequired = client.subscribeSimulatorConsentRequired(({ udid, tool }) => {
      setRequest({ udid, tool });
    });
    // Any recorded decision settles the wait, including one answered from another window.
    const unsubscribeChanged = client.subscribeSimulatorConsentChanged((state) => {
      setRequest((current) =>
        current !== null && state.entries.some((entry) => entry.udid === current.udid)
          ? null
          : current,
      );
    });
    return () => {
      unsubscribeRequired();
      unsubscribeChanged();
    };
  }, [client]);

  return request;
}
