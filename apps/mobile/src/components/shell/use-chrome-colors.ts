import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import type { ChromeColors } from '@mobile/components/shell/use-chrome-colors.types';

/** Android chrome reads Material You dynamic roles, so RN-drawn headers and backgrounds match
 * the Compose surfaces instead of the app's own brand tokens. */
export function useChromeColors(): ChromeColors {
  const colors = useAppMaterialColors();

  return {
    background: colors.surface,
    title: colors.onSurface,
    tint: colors.primary,
    subtle: colors.onSurfaceVariant,
  };
}
