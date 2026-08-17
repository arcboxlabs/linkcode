import type { MaterialColors } from '@expo/ui/jetpack-compose';
import { useMaterialColors } from '@expo/ui/jetpack-compose';
import { useSettingsStore } from '@mobile/stores/settings-store';
import { useColorScheme } from 'react-native';

/** The app's resolved scheme: the in-app appearance preference, falling back to the system. */
export function useResolvedColorScheme(): 'light' | 'dark' {
  const preference = useSettingsStore((state) => state.themePreference);
  const system = useColorScheme();
  if (preference === 'system') return system === 'dark' ? 'dark' : 'light';
  return preference;
}

/** `useMaterialColors` pinned to the APP theme: the bare hook follows the system scheme, which
 * diverges the moment the in-app appearance preference overrides it. Android components must use
 * this (and `ThemedHost`), never the bare forms. */
export function useAppMaterialColors(): MaterialColors {
  return useMaterialColors({ colorScheme: useResolvedColorScheme() });
}
