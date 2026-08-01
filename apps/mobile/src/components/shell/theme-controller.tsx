import { useSettingsStore } from '@mobile/stores/settings-store';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Uniwind, useUniwind } from 'uniwind';

/**
 * Applies the persisted theme preference to uniwind ('system' follows the OS adaptively)
 * and keeps the status bar readable against the active theme.
 */
export function ThemeController(): React.ReactNode {
  const preference = useSettingsStore((state) => state.themePreference);
  const { theme } = useUniwind();

  useEffect(() => {
    Uniwind.setTheme(preference);
  }, [preference]);

  return <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />;
}
