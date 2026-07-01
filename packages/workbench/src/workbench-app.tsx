import type { Transport } from '@linkcode/transport';
import { WorkbenchAppProviders } from './app-providers';
import type { WorkbenchShellComponent } from './workbench';
import { Workbench } from './workbench';
import { WorkbenchProviders } from './workbench-providers';

export interface WorkbenchAppProps {
  transport: Transport;
  daemonUrl?: string;
  shellComponent?: WorkbenchShellComponent;
}

export function WorkbenchApp({
  transport,
  daemonUrl,
  shellComponent,
}: WorkbenchAppProps): React.ReactNode {
  return (
    <WorkbenchAppProviders>
      <WorkbenchProviders transport={transport} daemonUrl={daemonUrl}>
        <Workbench shellComponent={shellComponent} />
      </WorkbenchProviders>
    </WorkbenchAppProviders>
  );
}
