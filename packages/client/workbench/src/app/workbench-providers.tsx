import type * as React from 'react';
import type { WorkbenchConnectionSource } from '../runtime/connection-controller';
import { DebugProvider } from '../runtime/debug';
import { WorkbenchConnectionGate, WorkbenchRuntimeProvider } from '../runtime/provider';
import { ConnectionState } from './connection-state';

export interface WorkbenchProvidersProps extends React.PropsWithChildren {
  /** Resolves a fresh physical transport for every connection generation. */
  connectionSource: WorkbenchConnectionSource;
  /** Renders while connecting or after an error, replacing `children` entirely (the connection
   * gate). Defaults to the built-in `ConnectionState` screen. */
  fallback?: React.ReactNode;
  /**
   * Rendered inside the runtime contexts but OUTSIDE the connection gate — for surfaces that must
   * stay mounted while the daemon is unreachable (desktop Settings): requests pend/fail until the
   * transport is ready, and push subscriptions register locally and deliver once connected.
   * Renders as a DOM sibling AFTER the gate's output, so it covers the gated tree only if it
   * paints above it (a fixed full-viewport overlay).
   */
  ungated?: React.ReactNode;
}

/**
 * The workbench data plane + connection gate: DebugProvider → WorkbenchRuntimeProvider →
 * WorkbenchConnectionGate, with the gate wrapping `children` only.
 */
export function WorkbenchProviders({
  connectionSource,
  children,
  fallback,
  ungated,
}: WorkbenchProvidersProps): React.ReactNode {
  const connectionFallback = fallback ?? <ConnectionState />;
  return (
    <DebugProvider>
      <WorkbenchRuntimeProvider
        connectionSource={connectionSource}
        noGenerationFallback={connectionFallback}
      >
        <WorkbenchConnectionGate fallback={connectionFallback}>{children}</WorkbenchConnectionGate>
        {ungated}
      </WorkbenchRuntimeProvider>
    </DebugProvider>
  );
}
