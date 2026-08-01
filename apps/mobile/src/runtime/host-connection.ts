import type { HostProfile } from '@mobile/stores/host-store';
import { nullthrow } from 'foxact/nullthrow';
import { createContext, use } from 'react';
import type { HostClientState } from './use-host-client';

/** Intersection, not `extends`: `HostClientState` is the discriminated union that ties a non-null
 * `client` to `status: 'ready'`, and an interface would flatten that guarantee away. */
export type HostConnection = HostClientState & {
  host: HostProfile;
  /** What the connection is dialing, already formatted for display. */
  endpointLabel: string;
};

/** Carries the one connection the host layout owns. Tabs and the detail screens that push over the
 * tab bar are siblings in the route tree, so each would otherwise dial its own — three sockets to
 * the same daemon. Rendered directly as `<HostConnectionContext value={…}>`. */
export const HostConnectionContext = createContext<HostConnection | null>(null);

export function useHostConnection(): HostConnection {
  return nullthrow(
    use(HostConnectionContext),
    'useHostConnection must be used under the host layout',
  );
}

export function hostEndpointLabel(host: HostProfile): string {
  return 'url' in host ? host.url : `${host.name} · LinkCode Cloud`;
}
