import type { Transport } from '@linkcode/transport';
import type { WorkbenchShellComponent } from '../surface/shell';
import { Workbench } from '../surface/workbench';
import { WorkbenchAppProviders } from './app-providers';
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
