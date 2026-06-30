import { Workbench, WorkbenchProviders } from '@linkcode/workbench';
import type { ReactNode } from 'react';
import { DAEMON_URL, transport } from '@/lib/transport';
import { RootProviders } from '@/providers/root-providers';
import { WebWorkbenchShell } from '@/shell/web-workbench-shell';

export function App(): ReactNode {
  return (
    <RootProviders>
      <WorkbenchProviders transport={transport} daemonUrl={DAEMON_URL}>
        <Workbench shellComponent={WebWorkbenchShell} />
      </WorkbenchProviders>
    </RootProviders>
  );
}
