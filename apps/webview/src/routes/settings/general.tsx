import { GeneralSettingsPanel } from '@linkcode/ui';
import { setProductAnalyticsEnabled, useProductAnalyticsPreference } from '@linkcode/workbench';
import { usePageTitle } from '@webview/hooks/use-page-title';
import { useSettingsStore } from '@webview/settings/store';
import { useTranslations } from 'use-intl';

export function GeneralSettings(): React.ReactNode {
  const tTabs = useTranslations('settings.tabs');
  usePageTitle(tTabs('general'));
  const locale = useSettingsStore((state) => state.locale);
  const setLocale = useSettingsStore((state) => state.setLocale);
  const productAnalyticsEnabled = useProductAnalyticsPreference((state) => state.enabled);

  return (
    <GeneralSettingsPanel
      locale={locale}
      productAnalyticsEnabled={productAnalyticsEnabled}
      onLocaleChange={setLocale}
      onProductAnalyticsEnabledChange={setProductAnalyticsEnabled}
    />
  );
}
