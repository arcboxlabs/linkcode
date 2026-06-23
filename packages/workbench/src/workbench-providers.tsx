import { LinkCodeProvider } from '@linkcode/client-core';
import type { Transport } from '@linkcode/transport';
import { Button } from 'coss-ui/components/button';
import type * as React from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { DebugProvider } from './debug';
import {
  useWorkbenchRuntimeRetry,
  useWorkbenchRuntimeStatus,
  useWorkbenchSdkClient,
  WorkbenchRuntimeProvider,
} from './runtime';

export type WorkbenchConnectionStatus = 'connecting' | 'error';

export interface WorkbenchProvidersProps extends React.PropsWithChildren {
  transport: Transport;
  /** Used by the default connection-state fallback to tell the user where the host should be. */
  daemonUrl?: string;
  /**
   * Renders while the transport is connecting or after it errored, replacing
   * `children` entirely (this is the connection gate). Defaults to the built-in
   * `ConnectionState` screen.
   */
  fallback?: ReactNode;
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
}: WorkbenchProvidersProps): ReactElement {
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

function WorkbenchLinkCodeProvider({ children }: React.PropsWithChildren): ReactElement {
  const client = useWorkbenchSdkClient();
  return <LinkCodeProvider client={client.raw}>{children}</LinkCodeProvider>;
}

export function ConnectionState({ daemonUrl }: { daemonUrl?: string }): ReactElement {
  const status = useWorkbenchRuntimeStatus();
  const retry = useWorkbenchRuntimeRetry();
  const t = useTranslations('workbench.connection');
  const common = useTranslations('common');

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        {status === 'connecting' ? (
          <p className="text-muted-foreground text-sm">{t('connecting')}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-destructive-foreground text-sm">
              {t('error', {
                url: daemonUrl ?? '127.0.0.1:4317',
                command: common('daemonCommand'),
              })}
            </p>
            <Button variant="outline" size="sm" onClick={retry}>
              {t('retry')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
