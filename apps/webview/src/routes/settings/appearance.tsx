import { AppearanceSettingsPanel } from '@linkcode/ui';
import { usePageTitle } from '@webview/hooks/use-page-title';
import { useSettingsStore } from '@webview/settings/store';
import { useTranslations } from 'use-intl';

export function AppearanceSettings(): React.ReactNode {
  const tTabs = useTranslations('settings.tabs');
  usePageTitle(tTabs('appearance'));
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);

  return <AppearanceSettingsPanel theme={theme} onThemeChange={setTheme} />;
}
