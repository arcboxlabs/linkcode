import { GeneralSettingsPanel } from '@linkcode/ui';
import { setProductAnalyticsEnabled, useProductAnalyticsPreference } from '@linkcode/workbench';
import { useDesktopSettingsStore } from './store';

export function GeneralTab(): React.ReactNode {
  const localeOverride = useDesktopSettingsStore((state) => state.localeOverride);
  const setLocaleOverride = useDesktopSettingsStore((state) => state.setLocaleOverride);
  const productAnalyticsEnabled = useProductAnalyticsPreference((state) => state.enabled);

  return (
    <GeneralSettingsPanel
      locale={localeOverride}
      productAnalyticsEnabled={productAnalyticsEnabled}
      onLocaleChange={setLocaleOverride}
      onProductAnalyticsEnabledChange={setProductAnalyticsEnabled}
    />
  );
}
