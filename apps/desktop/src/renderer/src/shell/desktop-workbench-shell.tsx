import type { WorkbenchShellProps } from '@linkcode/workbench';
import { useNavigationHistoryStore, useProvidersSettingsStore } from '@linkcode/workbench';
import { systemBridge } from '@renderer/ipc';
import { openDesktopSettings, useDesktopSettingsStore } from '../settings/store';
import { DesktopShell } from './desktop-shell';

export function DesktopWorkbenchShell({ header, ...props }: WorkbenchShellProps): React.ReactNode {
  const theme = useDesktopSettingsStore((state) => state.theme);
  return (
    <DesktopShell
      {...props}
      systemBridge={systemBridge}
      header={header}
      onOpenSettings={() => openDesktopSettings()}
      onOpenBilling={() => openDesktopSettings('billing')}
      onOpenProviderSettings={() => {
        useProvidersSettingsStore.getState().startAdd();
        openDesktopSettings('providers');
      }}
      onOpenAutomations={() => useNavigationHistoryStore.getState().openOverlay('automations')}
      onImportHistory={() => openDesktopSettings('history-import')}
      themeType={theme}
    />
  );
}
