import { useNativePalette } from '@mobile/components/theme/native-palette';
import { ActivityIndicator, View } from 'react-native';
import { BrandMark } from './brand-mark';

export function AppLoadingScreen(): React.ReactNode {
  const palette = useNativePalette();
  return (
    <View
      className="flex-1 items-center justify-center gap-6"
      style={{ backgroundColor: palette.background }}
    >
      <BrandMark size={80} />
      <ActivityIndicator accessibilityRole="progressbar" color={palette.tint} />
    </View>
  );
}
