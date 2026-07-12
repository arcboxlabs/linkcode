import { ProvidersSettingsPanel } from '@linkcode/workbench';
import { usePageTitle } from '@webview/hooks/use-page-title';
import { useTranslations } from 'use-intl';

/** The shared providers page lives in `@linkcode/workbench`; webview only adds the page title. */
export function ProvidersSettings(): React.ReactNode {
  const tTabs = useTranslations('settings.tabs');
  usePageTitle(tTabs('providers'));
  return <ProvidersSettingsPanel />;
}
