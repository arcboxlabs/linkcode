import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import type { NativePalette } from '@mobile/components/theme/native-palette.types';

/** Android resolves the palette from Material You dynamic roles (the same scheme the Compose
 * surfaces render), pinned to the app theme. */
export function useNativePalette(): NativePalette {
  const colors = useAppMaterialColors();

  return {
    background: colors.surface,
    groupedBackground: colors.surface,
    surface: colors.surfaceContainerHigh,
    text: colors.onSurface,
    textSecondary: colors.onSurfaceVariant,
    tint: colors.primary,
    onTint: colors.onPrimary,
    outline: colors.outlineVariant,
    danger: colors.error,
    success: colors.primary,
    warning: colors.tertiary,
  };
}
