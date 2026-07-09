import type { WorkbenchShellProps } from '@linkcode/workbench';
import { useNavigationHistoryStore } from '@linkcode/workbench';
import { systemBridge } from '@renderer/ipc';
import { useDesktopSettingsStore } from '../settings/store';
import { DesktopShell } from './desktop-shell';

export function DesktopWorkbenchShell({ header, ...props }: WorkbenchShellProps): React.ReactNode {
  const openOverlay = useNavigationHistoryStore((state) => state.openOverlay);
  const theme = useDesktopSettingsStore((state) => state.theme);
  return (
    <DesktopShell
      systemBridge={systemBridge}
      header={header}
      onOpenSettings={() => openOverlay('settings')}
      themeType={theme}
      {...props}
    />
  );
}
