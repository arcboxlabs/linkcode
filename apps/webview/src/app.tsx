import { Workbench, WorkbenchProviders } from '@linkcode/workbench';
import { DAEMON_URL, transport } from '@webview/lib/transport';
import { RootProviders } from '@webview/providers/root-providers';
import { WebWorkbenchShell } from '@webview/shell/web-workbench-shell';
import type { ReactNode } from 'react';

export function App(): ReactNode {
  return (
    <RootProviders>
      <WorkbenchProviders transport={transport} daemonUrl={DAEMON_URL}>
        <Workbench shellComponent={WebWorkbenchShell} />
      </WorkbenchProviders>
    </RootProviders>
  );
}
