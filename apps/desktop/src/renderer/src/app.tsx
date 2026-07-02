import { SocketIoTransport } from '@linkcode/transport';
import { Workbench, WorkbenchAppProviders, WorkbenchProviders } from '@linkcode/workbench';
import { useSingleton } from 'foxact/use-singleton';
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
  const { current: transport } = useSingleton(() => new SocketIoTransport({ url: daemonUrl }));
  return (
    <WorkbenchProviders transport={transport} daemonUrl={daemonUrl}>
      {children}
    </WorkbenchProviders>
  );
}
