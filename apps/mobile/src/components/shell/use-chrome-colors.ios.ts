import type { ChromeColors } from '@mobile/components/shell/use-chrome-colors.types';
import { useThemeColor } from 'heroui-native';

/** iOS chrome keeps the app's own theme tokens; the contract exists for Android's Material You. */
export function useChromeColors(): ChromeColors {
  const [background, foreground, accent, muted] = useThemeColor([
    'background',
    'foreground',
    'accent',
    'muted',
  ]);

  return { background, title: foreground, tint: accent, subtle: muted };
}
