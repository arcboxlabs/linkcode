import type { Stack } from 'expo-router';
import { useThemeColor } from 'heroui-native';

type StackScreenOptions = NonNullable<React.ComponentProps<typeof Stack>['screenOptions']>;

/** Theme-synced native-stack chrome; every Stack in the app spreads these defaults.
 * Screens opt into a header per route via `Stack.Screen` options. */
export function useStackScreenOptions(): StackScreenOptions {
  const [background, foreground, accent] = useThemeColor(['background', 'foreground', 'accent']);
  return {
    headerShown: false,
    headerTintColor: accent,
    headerTitleStyle: { color: foreground },
    headerLargeTitleStyle: { color: foreground },
    // The bar never leaves its scroll-edge appearance: every screen's body is a SwiftUI host, so
    // UIKit finds no scroll view to track, and an unset scroll edge is fully transparent — content
    // scrolls crisply through the title. An alpha-zero background is what routes the appearance
    // through `configureWithTransparentBackground`, and the blur then fills it; the scroll-edge
    // appearance is copied from this one, so both states end up glass rather than flat colour.
    headerStyle: { backgroundColor: 'transparent' },
    headerBlurEffect: 'systemChromeMaterial',
    headerShadowVisible: false,
    headerBackButtonDisplayMode: 'minimal',
    contentStyle: { backgroundColor: background },
  };
}
