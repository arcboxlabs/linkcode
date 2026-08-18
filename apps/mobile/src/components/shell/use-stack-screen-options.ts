import { useChromeColors } from '@mobile/components/shell/use-chrome-colors';
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

/** Theme-synced native-stack chrome; every Stack in the app spreads these defaults.
 * Screens opt into a header per route via `Stack.Screen` options. Colors come from the
 * platform-split chrome palette: app tokens on iOS, Material You roles on Android. */
export function useStackScreenOptions(): StackScreenOptions {
  const chrome = useChromeColors();

  return {
    headerShown: false,
    headerLargeTitleEnabled: false,
    headerTintColor: chrome.tint,
    headerTitleStyle: { color: chrome.title },
    headerLargeTitleStyle: { color: chrome.title },
    // Android has no header blur; painting the header the content color keeps the screen
    // reading as one surface (the shadow is already off).
    ...(process.env.EXPO_OS !== 'ios' && {
      headerStyle: { backgroundColor: chrome.background },
    }),
    headerShadowVisible: false,
    headerBackButtonDisplayMode: 'minimal',
    contentStyle: { backgroundColor: chrome.background },
  };
}
