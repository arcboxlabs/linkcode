import type { WorkbenchShellComponent } from '@linkcode/workbench';
import { WorkbenchApp } from '@linkcode/workbench';
import { DAEMON_URL, transport } from './lib/transport';

export function WebviewApp({
  shellComponent,
}: {
  shellComponent?: WorkbenchShellComponent;
}): React.ReactNode {
  return (
    <WorkbenchApp transport={transport} daemonUrl={DAEMON_URL} shellComponent={shellComponent} />
  );
}
