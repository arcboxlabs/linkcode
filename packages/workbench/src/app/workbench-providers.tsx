import { LinkCodeProvider } from '@linkcode/client-core';
import type { Transport } from '@linkcode/transport';
import type * as React from 'react';
import { DebugProvider } from '../runtime/debug';
import { useWorkbenchSdkClient, WorkbenchRuntimeProvider } from '../runtime/provider';
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
}

/**
 * The workbench data plane + connection gate. Mounts, in order:
 *   1. `DebugProvider` (dev-only artificial delay / forced-loading toggles),
 *   2. `WorkbenchRuntimeProvider` (transport SDK client + `TayoriProvider` + `SWRConfig`),
 *   3. `LinkCodeProvider` (the event-stream/conversation context).
 *
 * While the transport is not yet `ready`, `fallback(status)` is shown instead of
 * `children`, so connection state acts as the gate to the connected experience.
 */
export function WorkbenchProviders({
  transport,
  daemonUrl,
  children,
  fallback,
}: WorkbenchProvidersProps): React.ReactNode {
  return (
    <DebugProvider>
      <WorkbenchRuntimeProvider
        transport={transport}
        fallback={fallback ?? <ConnectionState daemonUrl={daemonUrl} />}
      >
        <WorkbenchLinkCodeProvider>{children}</WorkbenchLinkCodeProvider>
      </WorkbenchRuntimeProvider>
    </DebugProvider>
  );
}

function WorkbenchLinkCodeProvider({ children }: React.PropsWithChildren): React.ReactNode {
  const client = useWorkbenchSdkClient();
  return <LinkCodeProvider client={client.raw}>{children}</LinkCodeProvider>;
}
