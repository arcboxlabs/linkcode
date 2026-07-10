import type { Transport } from '@linkcode/transport';
import type * as React from 'react';
import type { WorkbenchConnectionSource } from '../runtime/connection-controller';
import { DebugProvider } from '../runtime/debug';
import { WorkbenchConnectionGate, WorkbenchRuntimeProvider } from '../runtime/provider';
import { ConnectionState } from './connection-state';

interface WorkbenchProvidersBaseProps {
  /**
   * Renders while the transport is connecting or after it errored, replacing
   * `children` entirely (this is the connection gate). Defaults to the built-in
   * `ConnectionState` screen.
   */
  fallback?: React.ReactNode;
  /**
   * Rendered inside the runtime contexts but OUTSIDE the connection gate — for surfaces that must
   * stay mounted while the daemon is unreachable (desktop Settings) yet still use the data plane.
   * Their requests fail or pend until the transport is ready (revalidated once it is), and client
   * push subscriptions register locally and deliver once connected.
   *
   * Stacking contract: this renders as a DOM sibling AFTER the gate's output, so it only covers
   * the gated tree if it paints above it (a fixed full-viewport overlay, like Settings). This
   * slot is the canonical way to compose an ungated surface; `WorkbenchConnectionGate` is the
   * lower-level piece for apps assembling the providers themselves.
   */
  ungated?: React.ReactNode;
}

export type WorkbenchProvidersProps = React.PropsWithChildren<
  WorkbenchProvidersBaseProps &
    (
      | {
          /** Resolves a fresh physical transport for every connection generation. */
          connectionSource: WorkbenchConnectionSource;
          daemonUrl?: never;
          transport?: never;
        }
      | {
          connectionSource?: never;
          /** @deprecated Migrate the app boundary to a `WorkbenchConnectionSource`. */
          daemonUrl?: string;
          /** @deprecated A transport cannot create fresh recovery generations. */
          transport: Transport;
        }
    )
>;

/**
 * The workbench data plane + connection gate. Mounts, in order:
 *   1. `DebugProvider` (dev-only artificial delay / forced-loading toggles),
 *   2. `WorkbenchRuntimeProvider` (connection controller + generation-scoped SDK/Tayori/client),
 *   3. `WorkbenchConnectionGate` (fallback until the protocol is ready), around `children` only.
 */
export function WorkbenchProviders(props: WorkbenchProvidersProps): React.ReactNode {
  const { children, fallback, ungated } = props;
  const connectionFallback = fallback ?? (
    <ConnectionState daemonUrl={'daemonUrl' in props ? props.daemonUrl : undefined} />
  );
  const runtimeConnection =
    props.connectionSource !== undefined
      ? { connectionSource: props.connectionSource }
      : { transport: props.transport };
  return (
    <DebugProvider>
      <WorkbenchRuntimeProvider {...runtimeConnection} noGenerationFallback={connectionFallback}>
        <WorkbenchConnectionGate fallback={connectionFallback}>{children}</WorkbenchConnectionGate>
        {ungated}
      </WorkbenchRuntimeProvider>
    </DebugProvider>
  );
}
