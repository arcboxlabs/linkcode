import { WorkbenchProviders } from '@linkcode/workbench';
import { Outlet } from 'react-router';
import { DashboardLayout } from '@/layouts/dashboard-layout';
import { DAEMON_URL, transport } from '@/lib/transport';

/**
 * The connected route group's layout. `WorkbenchProviders` mounts the data plane
 * (transport client + tayori + SWR + LinkCode event stream) and acts as the
 * connection gate: until the local host is connected it renders its built-in
 * connection-state screen instead of the children below. Once connected, the
 * dashboard shell wraps the routed feature pages (`<Outlet />`).
 *
 * This is the local-host analogue of the dashboard's `(protected)` layout — the
 * connection state plays the role auth/session does in an HTTP dashboard.
 */
export function ConnectedLayout() {
  return (
    <WorkbenchProviders transport={transport} daemonUrl={DAEMON_URL}>
      <DashboardLayout>
        <Outlet />
      </DashboardLayout>
    </WorkbenchProviders>
  );
}
