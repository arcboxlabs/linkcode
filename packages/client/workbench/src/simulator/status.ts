import type { LinkCodeClient } from '@linkcode/client-core';
import type { SimulatorStatus } from '@linkcode/schema';
import type { SWRResponse } from 'swr';
import useSWR from 'swr';

/** The slice of `LinkCodeClient` the status hook needs. */
export type SimulatorStatusClient = Pick<LinkCodeClient, 'simulatorStatus'>;

/**
 * Host simulator provisioning status, shared by every consumer through one cache key.
 * A host with no simulator surface rejects the probe and reads as unavailable.
 */
export function useSimulatorStatus(
  client: SimulatorStatusClient,
  options?: { refreshInterval?: number },
): SWRResponse<SimulatorStatus> {
  return useSWR(
    'simulator-status',
    () => client.simulatorStatus().catch((): SimulatorStatus => ({ available: false })),
    { refreshInterval: options?.refreshInterval },
  );
}
