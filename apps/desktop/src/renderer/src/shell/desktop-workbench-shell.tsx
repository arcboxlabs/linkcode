import type { WorkbenchShellProps } from '@linkcode/workbench';
import { useNavigationHistoryStore } from '@linkcode/workbench';
import { systemBridge } from '@renderer/ipc';
import { openDesktopSettings, useDesktopSettingsStore } from '../settings/store';
import { DesktopShell } from './desktop-shell';

export function DesktopWorkbenchShell({ header, ...props }: WorkbenchShellProps): React.ReactNode {
  const theme = useDesktopSettingsStore((state) => state.theme);
  return (
    <DesktopShell
      systemBridge={systemBridge}
      header={header}
      onOpenSettings={() => openDesktopSettings()}
      onOpenAutomations={() => useNavigationHistoryStore.getState().openOverlay('automations')}
      onImportHistory={() => openDesktopSettings('history-import')}
      themeType={theme}
      {...props}
    />
  );
}
