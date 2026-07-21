import type { CloudHost } from '@linkcode/workbench';
import {
  CloudHostsProvider,
  CloudImProvider,
  ConnectionState,
  SessionNotifier,
  useNavigationHistoryStore,
  useWorkbenchRuntimeStatus,
  Workbench,
  WorkbenchAppProviders,
  WorkbenchProviders,
} from '@linkcode/workbench';
import { useAbortableEffect } from 'foxact/use-abortable-effect';
import { useState } from 'react';
import { DesktopAutomationsView } from './automations/automations-view';
import { desktopDaemonConnectionSource } from './daemon-connection-source';
import { systemBridge } from './ipc';
import { presentDesktopNotification } from './notifications';
import { SettingsView } from './settings/settings-view';
import { useDesktopSettingsStore } from './settings/store';
import { DesktopWindowControls } from './shell/chrome/window-controls';
import { ConnectionSkeleton } from './shell/connection-skeleton';
import { DesktopWorkbenchShell } from './shell/desktop-workbench-shell';

/** Cloud data comes from main (it holds the keychain session); see preload's bridge. */
const listCloudHosts = (): Promise<CloudHost[]> => window.linkcodeCloud.listHosts();
// The preload bridge implements CloudImSource verbatim; hand it to the provider as-is.
const cloudImSource = window.linkcodeCloud.im;

export function DesktopApp(): React.ReactNode {
  const localeOverride = useDesktopSettingsStore((state) => state.localeOverride);
  const settingsOpen = useNavigationHistoryStore((state) => state.overlay === 'settings');
  const automationsOpen = useNavigationHistoryStore((state) => state.overlay === 'automations');

  return (
    <WorkbenchAppProviders locale={localeOverride}>
      <CloudHostsProvider source={listCloudHosts}>
        <CloudImProvider source={cloudImSource}>
          <WorkbenchProviders
            connectionSource={desktopDaemonConnectionSource}
            // Ungated: Settings stays reachable while the daemon is down (needed to fix a bad daemon
            // URL), yet its history-import panel can still use the data plane once connected.
            ungated={settingsOpen ? <SettingsView /> : null}
            fallback={<DesktopConnectionFallback />}
          >
            <SessionNotifier present={presentDesktopNotification} />
            <OverlayUnderlay>
              <Workbench shellComponent={DesktopWorkbenchShell} />
            </OverlayUnderlay>
            {/* Gated: Automations lists schedules over the data plane, so it mounts inside the gate. */}
            {automationsOpen ? <DesktopAutomationsView /> : null}
          </WorkbenchProviders>
          {/* Window controls live above the connection gate and the settings overlay so Windows/Linux
              can always minimize/maximize/close — including while the daemon is connecting or down. */}
          <DesktopWindowControls />
        </CloudImProvider>
      </CloudHostsProvider>
    </WorkbenchAppProviders>
  );
}

/**
 * Hides (never unmounts) the workbench-side layer while a full-page overlay (Settings, Automations)
 * covers it: both shells are translucent over the native backdrop, so painted pixels underneath
 * ghost through the overlay. `visibility` keeps layout/PTY state intact; `inert` blocks focus.
 */
function OverlayUnderlay({ children }: React.PropsWithChildren): React.ReactNode {
  const overlayOpen = useNavigationHistoryStore((state) => state.overlay !== null);
  return (
    <div className={overlayOpen ? 'invisible h-full' : 'h-full'} inert={overlayOpen}>
      {children}
    </div>
  );
}

/**
 * Early dial failures on a supervised daemon are startup (~250ms boot measured), not an outage —
 * keep the skeleton up. Measured from renderer boot, not mount: a later outage remounts this
 * fallback, and restarting the grace then would hide the error screen (and its Retry button)
 * for another full window.
 */
const MANAGED_STARTUP_GRACE_MS = 10000;
const RENDERER_BOOT_AT = Date.now();

/**
 * Desktop connection gate: a shell-shaped skeleton while connecting (plus the managed startup grace),
 * then the shared `ConnectionState`. Endpoint rediscovery is owned by the connection source, not here.
 */
function DesktopConnectionFallback(): React.ReactNode {
  const status = useWorkbenchRuntimeStatus();
  const managed = useDaemonIsManaged();

  const [withinStartupGrace, setWithinStartupGrace] = useState(
    () => Date.now() - RENDERER_BOOT_AT < MANAGED_STARTUP_GRACE_MS,
  );
  useAbortableEffect((signal) => {
    const remaining = MANAGED_STARTUP_GRACE_MS - (Date.now() - RENDERER_BOOT_AT);
    if (remaining <= 0) return;
    const timer = setTimeout(() => {
      if (!signal.aborted) setWithinStartupGrace(false);
    }, remaining);
    return () => clearTimeout(timer);
  }, []);

  if (status === 'connecting' || (managed && withinStartupGrace)) return <ConnectionSkeleton />;
  return <ConnectionState managedHost={managed} />;
}

/** Whether main supervises the daemon (packaged, no override) — picks the failure copy. */
function useDaemonIsManaged(): boolean {
  const daemonUrlOverride = useDesktopSettingsStore((state) => state.daemonUrlOverride);
  const [managed, setManaged] = useState(false);
  useAbortableEffect(
    (signal) => {
      void systemBridge.daemon.isManaged().then((value) => {
        if (!signal.aborted) setManaged(value);
      });
    },
    [daemonUrlOverride],
  );
  return managed;
}
