import { GeneralSettingsPanel } from '@linkcode/ui';
import { useSettingsStore } from '@webview/settings/store';

export function GeneralSettings(): React.ReactNode {
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const locale = useSettingsStore((state) => state.locale);
  const setLocale = useSettingsStore((state) => state.setLocale);

  return (
    <GeneralSettingsPanel
      theme={theme}
      onThemeChange={setTheme}
      locale={locale}
      onLocaleChange={setLocale}
    />
  );
}
