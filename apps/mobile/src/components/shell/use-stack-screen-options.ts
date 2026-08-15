import type { Stack } from 'expo-router';
import { useThemeColor } from 'heroui-native';
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

/** Theme-synced native-stack chrome; every Stack in the app spreads these defaults.
 * Screens opt into a header per route via `Stack.Screen` options. */
export function useStackScreenOptions(): StackScreenOptions {
  const [background, foreground, accent] = useThemeColor(['background', 'foreground', 'accent']);

  return {
    headerShown: false,
    headerLargeTitleEnabled: false,
    headerTintColor: accent,
    headerTitleStyle: { color: foreground },
    headerLargeTitleStyle: { color: foreground },
    ...(process.env.EXPO_OS !== 'ios' && {
      headerBlurEffect: 'systemChromeMaterial' as const,
      headerStyle: { backgroundColor: 'transparent' },
    }),
    headerShadowVisible: false,
    headerBackButtonDisplayMode: 'minimal',
    contentStyle: { backgroundColor: background },
  };
}
