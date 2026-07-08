import type { CloudHost } from '@linkcode/workbench';
import {
  CloudHostsProvider,
  ConnectionState,
  createDaemonTransport,
  useNavigationHistoryStore,
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
import { DesktopWindowControls } from './shell/chrome/window-controls';
import { ConnectionSkeleton } from './shell/connection-skeleton';
import { DesktopWorkbenchShell } from './shell/desktop-workbench-shell';

/** The cloud host list comes from main (it holds the keychain session); see preload's bridge. */
const listCloudHosts = (): Promise<CloudHost[]> => window.linkcodeCloud.listHosts();

export function DesktopApp(): React.ReactNode {
  const daemonUrl = useDesktopSettingsStore((state) => state.daemonUrl);
  const localeOverride = useDesktopSettingsStore((state) => state.localeOverride);
  const settingsOpen = useNavigationHistoryStore((state) => state.overlay === 'settings');

  return (
    <WorkbenchAppProviders locale={localeOverride}>
      <CloudHostsProvider source={listCloudHosts}>
        {/* Remount on daemon-URL change: the old transport tears down via WorkbenchProviders cleanup. */}
        <DaemonConnection
          key={daemonUrl}
          daemonUrl={daemonUrl}
          // Ungated: Settings stays reachable while the daemon is down (needed to fix a bad daemon
          // URL), yet its history-import panel can still use the data plane once connected.
          ungated={settingsOpen ? <SettingsView /> : null}
        >
          {/* Hidden (not unmounted) while Settings overlays it: both shells are translucent over
              the native backdrop, so any workbench pixels underneath would ghost through the
              settings sidebar. `visibility` keeps layout/PTY state intact; `inert` blocks
              focus/interaction. */}
          <div className={settingsOpen ? 'invisible h-full' : 'h-full'} inert={settingsOpen}>
            <Workbench shellComponent={DesktopWorkbenchShell} />
          </div>
        </DaemonConnection>
        {/* Window controls live above the connection gate and the settings overlay so Windows/Linux
            can always minimize/maximize/close — including while the daemon is connecting or down. */}
        <DesktopWindowControls />
      </CloudHostsProvider>
    </WorkbenchAppProviders>
  );
}

/** The desktop renderer connects to the local daemon (apps/daemon) like every other client. */
function DaemonConnection({
  daemonUrl,
  ungated,
  children,
}: React.PropsWithChildren<{ daemonUrl: string; ungated?: React.ReactNode }>): React.ReactNode {
  const { current: transport } = useSingleton(() => createDaemonTransport(daemonUrl));
  return (
    <WorkbenchProviders
      transport={transport}
      daemonUrl={daemonUrl}
      fallback={<DesktopConnectionFallback daemonUrl={daemonUrl} />}
      ungated={ungated}
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
  // Settings renders ungated above this fallback; hide (not unmount) so no pixels ghost through
  // the translucent settings shell while the rediscovery subscription keeps running.
  const settingsOpen = useNavigationHistoryStore((state) => state.overlay === 'settings');

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

  return (
    <div className={settingsOpen ? 'invisible h-full' : 'h-full'} inert={settingsOpen}>
      {status === 'connecting' || (managed && withinStartupGrace) ? (
        <ConnectionSkeleton />
      ) : (
        <ConnectionState daemonUrl={daemonUrl} managedHost={managed} />
      )}
    </div>
  );
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
