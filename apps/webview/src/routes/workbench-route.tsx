import { useCommandPaletteStore, Workbench } from '@linkcode/workbench';
import { usePageTitle } from '@webview/hooks/use-page-title';
import { WebWorkbenchShell } from '@webview/shell/web-workbench-shell';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTranslations } from 'use-intl';

/** Index route: the workbench surface (session / conversation / composer). */
export function WorkbenchRoute(): React.ReactNode {
  const navigate = useNavigate();
  const t = useTranslations('workbench.palette');
  const tWorkbench = useTranslations('workbench');
  usePageTitle(tWorkbench('pageTitle'));
  useEffect(() => {
    const { registerCommands, unregisterCommands } = useCommandPaletteStore.getState();
    registerCommands('webview', [
      {
        id: 'webview.settings',
        label: t('openSettings'),
        run() {
          void navigate('/settings');
        },
      },
    ]);
    return () => unregisterCommands('webview');
  }, [navigate, t]);

  return <Workbench shellComponent={WebWorkbenchShell} />;
}
