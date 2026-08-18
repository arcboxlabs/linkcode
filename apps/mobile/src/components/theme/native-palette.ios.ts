import type { NativePalette } from '@mobile/components/theme/native-palette.types';
import { Color } from 'expo-router';

/** iOS resolves the palette from UIKit semantic colors — `PlatformColor` values that adapt to
 * light/dark natively, so no hook state is needed. White-on-blue matches UIKit's own filled
 * controls, which never invert their glyph. */
const IOS_PALETTE: NativePalette = {
  background: Color.ios.systemBackground,
  surface: Color.ios.secondarySystemBackground,
  text: Color.ios.label,
  textSecondary: Color.ios.secondaryLabel,
  tint: Color.ios.systemBlue,
  onTint: '#FFFFFF',
  outline: Color.ios.separator,
  danger: Color.ios.systemRed,
  success: Color.ios.systemGreen,
  warning: Color.ios.systemOrange,
};

// eslint-disable-next-line @eslint-react/no-unnecessary-use-prefix -- the Android twin resolves its palette through hooks; the shared contract keeps the hook name
export function useNativePalette(): NativePalette {
  return IOS_PALETTE;
}
