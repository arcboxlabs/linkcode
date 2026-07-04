import { GeneralSettingsPanel } from '@linkcode/ui';
import { useDesktopSettingsStore } from './store';

export function GeneralTab(): React.ReactNode {
  const theme = useDesktopSettingsStore((state) => state.theme);
  const setTheme = useDesktopSettingsStore((state) => state.setTheme);
  const localeOverride = useDesktopSettingsStore((state) => state.localeOverride);
  const setLocaleOverride = useDesktopSettingsStore((state) => state.setLocaleOverride);

  return (
    <GeneralSettingsPanel
      theme={theme}
      onThemeChange={setTheme}
      locale={localeOverride}
      onLocaleChange={setLocaleOverride}
    />
  );
}
