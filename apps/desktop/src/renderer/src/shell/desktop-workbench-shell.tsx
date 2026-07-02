import type { WorkbenchShellProps } from '@linkcode/workbench';
import { systemBridge } from '@renderer/ipc';
import { useDesktopSettingsStore } from '../settings/store';
import { DesktopShell } from './desktop-shell';

export function DesktopWorkbenchShell({ header, ...props }: WorkbenchShellProps): React.ReactNode {
  const openSettings = useDesktopSettingsStore((state) => state.openSettings);
  const theme = useDesktopSettingsStore((state) => state.theme);
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
