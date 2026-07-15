import type { WorkbenchConnectionSource } from '../runtime/connection-controller';
import { AppearanceRenderPrefsProvider } from '../settings/appearance-render-prefs';
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
      <AppearanceRenderPrefsProvider>
        <WorkbenchProviders connectionSource={connectionSource}>
          <Workbench shellComponent={shellComponent} />
        </WorkbenchProviders>
      </AppearanceRenderPrefsProvider>
    </WorkbenchAppProviders>
  );
}
