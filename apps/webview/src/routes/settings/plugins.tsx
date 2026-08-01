import { PluginsSettingsPanel } from '@linkcode/workbench';
import { usePageTitle } from '@webview/hooks/use-page-title';
import { useTranslations } from 'use-intl';

/** The shared plugins page lives in `@linkcode/workbench`; webview only adds the page title. */
export function PluginsSettings(): React.ReactNode {
  const tTabs = useTranslations('settings.tabs');
  usePageTitle(tTabs('plugins'));
  return <PluginsSettingsPanel />;
}
