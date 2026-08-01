import type { ViewProps } from 'react-native';
import { Platform, requireNativeComponent, StyleSheet, View } from 'react-native';

const NativeBackdrop =
  Platform.OS === 'ios' ? requireNativeComponent<ViewProps>('LinkCodeNavigationBarBackdrop') : View;

export function NavigationBarBackdrop(): React.ReactNode {
  return <NativeBackdrop pointerEvents="none" style={StyleSheet.absoluteFill} />;
}
