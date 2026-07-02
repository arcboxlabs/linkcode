import type { WorkbenchShellProps } from '@linkcode/workbench';
import { systemBridge } from '@renderer/ipc';
import { useDesktopAppConfig } from '../app-config-context';
import { DesktopShell } from './desktop-shell';

export function DesktopWorkbenchShell({ header, ...props }: WorkbenchShellProps): React.ReactNode {
  const { openSettings, theme } = useDesktopAppConfig();
  return (
    <DesktopShell
      systemBridge={systemBridge}
      header={header}
      onOpenSettings={openSettings}
      themeType={theme}
      {...props}
    />
  );
}
