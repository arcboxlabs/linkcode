import {
  ConnectionState,
  createDaemonTransport,
  useWorkbenchRuntimeStatus,
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
import { ConnectionSkeleton } from './shell/connection-skeleton';
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

/**
 * A supervised daemon needs a beat to boot (fork + engine + listener bind, ~250ms measured);
 * early dial failures within this window are startup, not an outage — keep the skeleton up.
 */
const MANAGED_STARTUP_GRACE_MS = 10000;

/**
 * Desktop connection gate: a shell-shaped skeleton while connecting (plus a startup grace window
 * on managed hosts), the shared `ConnectionState` once genuinely errored — and endpoint
 * rediscovery throughout. The transport retries a fixed URL, but the daemon port-hunts
 * (apps/daemon/src/runtime.ts) — a daemon that (re)started on another port is only reachable by
 * re-resolving discovery. Main pushes a runtime-file change event (fs.watch on ~/.linkcode);
 * mounted only while the gate is closed, so the subscription ends once the transport connects.
 */
function DesktopConnectionFallback({ daemonUrl }: { daemonUrl: string }): React.ReactNode {
  const status = useWorkbenchRuntimeStatus();
  const hasOverride = useDesktopSettingsStore((state) => state.daemonUrlOverride !== null);
  const adoptDiscoveredUrl = useDesktopSettingsStore((state) => state.adoptDiscoveredUrl);
  const managed = useDaemonIsManaged();

  const [withinStartupGrace, setWithinStartupGrace] = useState(true);
  useAbortableEffect((signal) => {
    const timer = setTimeout(() => {
      if (!signal.aborted) setWithinStartupGrace(false);
    }, MANAGED_STARTUP_GRACE_MS);
    signal.addEventListener('abort', () => clearTimeout(timer));
  }, []);

  useAbortableEffect(
    (signal) => {
      if (hasOverride) return;
      const rediscover = (): void => {
        const url = systemBridge.daemon.resolveUrl();
        if (url !== daemonUrl) adoptDiscoveredUrl(url);
      };
      // Catch a change that happened before this mount (e.g. the daemon moved while connected).
      rediscover();
      signal.addEventListener('abort', systemBridge.daemon.onRuntimeChanged(rediscover));
    },
    [hasOverride, daemonUrl, adoptDiscoveredUrl],
  );

  if (status === 'connecting' || (managed && withinStartupGrace)) return <ConnectionSkeleton />;
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
