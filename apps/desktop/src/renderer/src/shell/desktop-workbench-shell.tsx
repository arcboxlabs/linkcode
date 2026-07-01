import type { WorkbenchShellProps } from '@linkcode/workbench';
import { systemBridge } from '@renderer/ipc';
import { DesktopShell } from './desktop-shell';

export function DesktopWorkbenchShell({ header, ...props }: WorkbenchShellProps): React.ReactNode {
  return <DesktopShell systemBridge={systemBridge} header={header} {...props} />;
}
