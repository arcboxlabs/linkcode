import { useCommandPaletteHotkey, useCommandPaletteStore, Workbench } from '@linkcode/workbench';
import { usePageTitle } from '@webview/hooks/use-page-title';
import { presentWebNotification } from '@webview/notifications';
import { WebWorkbenchShell } from '@webview/shell/web-workbench-shell';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTranslations } from 'use-intl';

// The browser has no system plane, so the platform hint comes from the UA — mac-style labels for
// mac browsers, Ctrl for everything else.
const IS_MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');
const PALETTE_SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl+K';

/** Index route: the workbench surface (session / conversation / composer). */
export function WorkbenchRoute(): React.ReactNode {
  const navigate = useNavigate();
  const t = useTranslations('workbench.palette');
  const tWorkbench = useTranslations('workbench');
  usePageTitle(tWorkbench('pageTitle'));
  useCommandPaletteHotkey({ isMac: IS_MAC });
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

  return (
    <Workbench
      shellComponent={WebWorkbenchShell}
      paletteShortcut={PALETTE_SHORTCUT}
      presentNotification={presentWebNotification}
    />
  );
}
