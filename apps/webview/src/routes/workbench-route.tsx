import { Workbench } from '@linkcode/workbench';
import { WebWorkbenchShell } from '@webview/shell/web-workbench-shell';
import type { ReactNode } from 'react';

/** Index route: the workbench surface (session / conversation / composer). */
export function WorkbenchRoute(): ReactNode {
  return <Workbench shellComponent={WebWorkbenchShell} />;
}
