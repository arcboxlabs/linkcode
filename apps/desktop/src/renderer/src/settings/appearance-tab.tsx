import { AppearanceSettingsContainer } from '@linkcode/workbench';
import { useDesktopSettingsStore } from './store';

export function AppearanceTab(): React.ReactNode {
  const theme = useDesktopSettingsStore((state) => state.theme);
  const setTheme = useDesktopSettingsStore((state) => state.setTheme);

  return <AppearanceSettingsContainer theme={theme} onThemeChange={setTheme} />;
}
