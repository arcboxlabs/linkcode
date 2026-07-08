import { LinkCodeProvider } from '@linkcode/client-core';
import type { Transport } from '@linkcode/transport';
import type * as React from 'react';
import { DebugProvider } from '../runtime/debug';
import {
  useWorkbenchSdkClient,
  WorkbenchConnectionGate,
  WorkbenchRuntimeProvider,
} from '../runtime/provider';
import { ConnectionState } from './connection-state';

export interface WorkbenchProvidersProps extends React.PropsWithChildren {
  transport: Transport;
  /** Used by the default connection-state fallback to tell the user where the host should be. */
  daemonUrl?: string;
  /**
   * Renders while the transport is connecting or after it errored, replacing
   * `children` entirely (this is the connection gate). Defaults to the built-in
   * `ConnectionState` screen.
   */
  fallback?: React.ReactNode;
  /**
   * Rendered inside the runtime contexts but OUTSIDE the connection gate — for surfaces that must
   * stay mounted while the daemon is unreachable (desktop Settings) yet still use the data plane.
   * Their requests fail or pend until the transport is ready; no conversation context here.
   */
  ungated?: React.ReactNode;
}

/**
 * The workbench data plane + connection gate. Mounts, in order:
 *   1. `DebugProvider` (dev-only artificial delay / forced-loading toggles),
 *   2. `WorkbenchRuntimeProvider` (transport SDK client + `TayoriProvider` + `SWRConfig`),
 *   3. `WorkbenchConnectionGate` (fallback until the transport is ready),
 *   4. `LinkCodeProvider` (the event-stream/conversation context), around `children` only.
 */
export function WorkbenchProviders({
  transport,
  daemonUrl,
  children,
  fallback,
  ungated,
}: WorkbenchProvidersProps): React.ReactNode {
  return (
    <DebugProvider>
      <WorkbenchRuntimeProvider transport={transport}>
        <WorkbenchConnectionGate fallback={fallback ?? <ConnectionState daemonUrl={daemonUrl} />}>
          <WorkbenchLinkCodeProvider>{children}</WorkbenchLinkCodeProvider>
        </WorkbenchConnectionGate>
        {ungated}
      </WorkbenchRuntimeProvider>
    </DebugProvider>
  );
}

function WorkbenchLinkCodeProvider({ children }: React.PropsWithChildren): React.ReactNode {
  const client = useWorkbenchSdkClient();
  return <LinkCodeProvider client={client.raw}>{children}</LinkCodeProvider>;
}
