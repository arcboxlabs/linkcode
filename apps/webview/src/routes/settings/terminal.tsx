import { TerminalSettingsContainer } from '@linkcode/workbench';
import { usePageTitle } from '@webview/hooks/use-page-title';
import { useTranslations } from 'use-intl';

export function TerminalSettings(): React.ReactNode {
  const tTabs = useTranslations('settings.tabs');
  usePageTitle(tTabs('terminal'));

  return <TerminalSettingsContainer />;
}
