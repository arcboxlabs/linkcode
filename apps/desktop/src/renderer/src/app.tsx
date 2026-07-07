import {
  ConnectionState,
  createDaemonTransport,
  Workbench,
  WorkbenchAppProviders,
  WorkbenchProviders,
} from '@linkcode/workbench';
import { useAbortableEffect } from 'foxact/use-abortable-effect';
import { useSingleton } from 'foxact/use-singleton';
import { useState } from 'react';
import { systemBridge } from './ipc';
import { SettingsView } from './settings/settings-view';
import { useDesktopSettingsStore } from './settings/store';
import { DesktopWorkbenchShell } from './shell/desktop-workbench-shell';

export function DesktopApp(): React.ReactNode {
  const daemonUrl = useDesktopSettingsStore((state) => state.daemonUrl);
  const localeOverride = useDesktopSettingsStore((state) => state.localeOverride);
  const settingsOpen = useDesktopSettingsStore((state) => state.settingsOpen);

  return (
    <WorkbenchAppProviders locale={localeOverride}>
      {/* Hidden (not unmounted) while Settings overlays it: both shells are translucent over the
          native backdrop, so any workbench pixels underneath would ghost through the settings
          sidebar. `visibility` keeps layout/PTY state intact; `inert` blocks focus/interaction. */}
      <div className={settingsOpen ? 'invisible h-full' : 'h-full'} inert={settingsOpen}>
        {/* Remount on daemon-URL change: the old transport tears down via WorkbenchProviders cleanup. */}
        <DaemonConnection key={daemonUrl} daemonUrl={daemonUrl}>
          <Workbench shellComponent={DesktopWorkbenchShell} />
        </DaemonConnection>
      </div>
      {settingsOpen ? <SettingsView /> : null}
    </WorkbenchAppProviders>
  );
}

/** The desktop renderer connects to the local daemon (apps/daemon) like every other client. */
function DaemonConnection({
  daemonUrl,
  children,
}: React.PropsWithChildren<{ daemonUrl: string }>): React.ReactNode {
  const { current: transport } = useSingleton(() => createDaemonTransport(daemonUrl));
  return (
    <WorkbenchProviders
      transport={transport}
      daemonUrl={daemonUrl}
      fallback={<DesktopConnectionFallback daemonUrl={daemonUrl} />}
    >
      {children}
    </WorkbenchProviders>
  );
}

const REDISCOVER_INTERVAL_MS = 2000;

/**
 * Desktop connection gate: the shared `ConnectionState` plus endpoint rediscovery. The transport
 * retries a fixed URL, but the daemon port-hunts (apps/daemon/src/runtime.ts) — a daemon that
 * (re)started on another port is only reachable by re-resolving discovery. Mounted only while the
 * gate is closed, so polling stops as soon as the transport connects.
 */
function DesktopConnectionFallback({ daemonUrl }: { daemonUrl: string }): React.ReactNode {
  const hasOverride = useDesktopSettingsStore((state) => state.daemonUrlOverride !== null);
  const adoptDiscoveredUrl = useDesktopSettingsStore((state) => state.adoptDiscoveredUrl);
  const managed = useDaemonIsManaged();

  useAbortableEffect(
    (signal) => {
      if (hasOverride) return;
      const timer = setInterval(() => {
        const url = systemBridge.daemon.resolveUrl();
        if (url !== daemonUrl) adoptDiscoveredUrl(url);
      }, REDISCOVER_INTERVAL_MS);
      signal.addEventListener('abort', () => clearInterval(timer));
    },
    [hasOverride, daemonUrl, adoptDiscoveredUrl],
  );

  return <ConnectionState daemonUrl={daemonUrl} managedHost={managed} />;
}

/** Whether main supervises the daemon (packaged, no override) — picks the failure copy. */
function useDaemonIsManaged(): boolean {
  const [managed, setManaged] = useState(false);
  useAbortableEffect((signal) => {
    void systemBridge.daemon.isManaged().then((value) => {
      if (!signal.aborted) setManaged(value);
    });
  }, []);
  return managed;
}
