import { GeneralSettingsPanel } from '@linkcode/ui';
import { usePageTitle } from '@webview/hooks/use-page-title';
import { useSettingsStore } from '@webview/settings/store';
import { useTranslations } from 'use-intl';

export function GeneralSettings(): React.ReactNode {
  const tTabs = useTranslations('settings.tabs');
  usePageTitle(tTabs('general'));
  const locale = useSettingsStore((state) => state.locale);
  const setLocale = useSettingsStore((state) => state.setLocale);

  return <GeneralSettingsPanel locale={locale} onLocaleChange={setLocale} />;
}
