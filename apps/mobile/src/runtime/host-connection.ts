import type { HostProfile } from '@mobile/stores/host-store';
import { createContext, use } from 'react';
import type { HostClientState } from './use-host-client';

/** Intersection, not `extends`: `HostClientState` is the discriminated union that ties a non-null
 * `client` to `status: 'ready'`, and an interface would flatten that guarantee away. */
export type HostConnection = HostClientState & {
  host: HostProfile;
  /** What the connection is dialing, already formatted for display. */
  endpointLabel: string;
};

/** Carries the one connection {@link HostConnectionScope} owns, above the whole navigator.
 * Rendered directly as `<HostConnectionContext value={…}>`. */
export const HostConnectionContext = createContext<HostConnection | null>(null);

/** Null when no host is selected — the registry can be empty, or the selected host removed. */
export function useHostConnection(): HostConnection | null {
  return use(HostConnectionContext);
}

export function hostEndpointLabel(host: HostProfile): string {
  return 'url' in host ? host.url : `${host.name} · LinkCode Cloud`;
}
