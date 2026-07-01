import { Workbench } from '@linkcode/workbench';
import { WebWorkbenchShell } from '@webview/shell/web-workbench-shell';

/** Index route: the workbench surface (session / conversation / composer). */
export function WorkbenchRoute(): React.ReactNode {
  return <Workbench shellComponent={WebWorkbenchShell} />;
}
