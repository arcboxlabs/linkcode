import { useNativePalette } from '@mobile/components/theme/native-palette';
import type { Stack } from 'expo-router';
import { NavigationBarBackdrop } from '../../../modules/linkcode-navigation-bar-backdrop';
import { USES_IOS_26_NAVIGATION } from './ios-26-navigation';

type StackScreenOptions = NonNullable<React.ComponentProps<typeof Stack>['screenOptions']>;

const IOS_VISIBLE_HEADER_OPTIONS: StackScreenOptions = USES_IOS_26_NAVIGATION
  ? {
      headerBackground: NavigationBarBackdrop,
      headerTransparent: true,
      scrollEdgeEffects: {
        top: 'hidden' as const,
      },
    }
  : {
      headerBlurEffect: 'systemChromeMaterial' as const,
      headerTransparent: true,
    };

// Keep `headerBackground` off Stack defaults: Expo renders it even when `headerShown` is false.
export const VISIBLE_HEADER_OPTIONS: StackScreenOptions = {
  headerShown: true,
  ...(process.env.EXPO_OS === 'ios' && IOS_VISIBLE_HEADER_OPTIONS),
};

export const LARGE_TITLE_HEADER_OPTIONS: StackScreenOptions = {
  headerLargeTitleEnabled: true,
  headerShown: true,
};

/** Native-color stack chrome; every Stack in the app spreads these defaults. Screens opt into a
 * header per route via `Stack.Screen` options. Colors come from the platform-split native
 * palette: UIKit system colors on iOS, Material You roles on Android. */
export function useStackScreenOptions(): StackScreenOptions {
  const palette = useNativePalette();

  return {
    headerShown: false,
    headerLargeTitleEnabled: false,
    headerTintColor: palette.tint,
    headerTitleStyle: { color: palette.text },
    headerLargeTitleStyle: { color: palette.text },
    // Android has no header blur; painting the header the content color keeps the screen
    // reading as one surface (the shadow is already off).
    ...(process.env.EXPO_OS !== 'ios' && {
      headerStyle: { backgroundColor: palette.background },
    }),
    headerShadowVisible: false,
    headerBackButtonDisplayMode: 'minimal',
    contentStyle: { backgroundColor: palette.background },
  };
}
