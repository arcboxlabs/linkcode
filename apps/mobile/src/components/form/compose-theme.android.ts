import type { MaterialColors } from '@expo/ui/jetpack-compose';
import { useMaterialColors } from '@expo/ui/jetpack-compose';
import { useResolvedColorScheme } from '@mobile/components/theme/use-color-scheme';

/** `useMaterialColors` pinned to the APP theme: the bare hook follows the system scheme, which
 * diverges the moment the in-app appearance preference overrides it. Android components must use
 * this (and `ThemedHost`), never the bare forms. */
export function useAppMaterialColors(): MaterialColors {
  return useMaterialColors({ colorScheme: useResolvedColorScheme() });
}
