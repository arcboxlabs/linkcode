import { useSettingsStore } from '@mobile/stores/settings-store';
import { useColorScheme } from 'react-native';

export function useResolvedColorScheme(): 'light' | 'dark' {
  const preference = useSettingsStore((state) => state.themePreference);
  const system = useColorScheme();
  if (preference === 'system') return system === 'dark' ? 'dark' : 'light';
  return preference;
}
