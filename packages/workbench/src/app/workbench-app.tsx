import type { WorkbenchConnectionSource } from '../runtime/connection-controller';
import type { WorkbenchShellComponent } from '../surface/shell';
import { Workbench } from '../surface/workbench';
import { WorkbenchAppProviders } from './app-providers';
import { WorkbenchProviders } from './workbench-providers';

export interface WorkbenchAppProps {
  connectionSource: WorkbenchConnectionSource;
  shellComponent?: WorkbenchShellComponent;
}

export function WorkbenchApp({
  connectionSource,
  shellComponent,
}: WorkbenchAppProps): React.ReactNode {
  return (
    <WorkbenchAppProviders>
      <WorkbenchProviders connectionSource={connectionSource}>
        <Workbench shellComponent={shellComponent} />
      </WorkbenchProviders>
    </WorkbenchAppProviders>
  );
}
