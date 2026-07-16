import { Image, StyleSheet, View } from 'react-native';
import icon from '../../assets/splash-icon.png';

/**
 * The app icon as an in-app brand mark: the transparent splash glyph on a
 * white tile, so it reads as the app icon on light and dark themes alike.
 */
export function BrandMark({ size = 96 }: { size?: number }): React.ReactNode {
  return (
    <View
      className="items-center justify-center bg-white"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(0, 0, 0, 0.1)',
      }}
    >
      <Image source={icon} style={{ width: size, height: size }} />
    </View>
  );
}
