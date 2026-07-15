import { AppearanceSettingsPanel } from '@linkcode/ui';
import { useDesktopSettingsStore } from './store';

export function AppearanceTab(): React.ReactNode {
  const theme = useDesktopSettingsStore((state) => state.theme);
  const setTheme = useDesktopSettingsStore((state) => state.setTheme);

  return <AppearanceSettingsPanel theme={theme} onThemeChange={setTheme} />;
}
