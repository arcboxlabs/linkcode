import type { Stack } from 'expo-router';
import { useThemeColor } from 'heroui-native';

type StackScreenOptions = NonNullable<React.ComponentProps<typeof Stack>['screenOptions']>;

/** Theme-synced native-stack chrome; every Stack in the app spreads these defaults.
 * Screens opt into a header per route via `Stack.Screen` options. */
export function useStackScreenOptions(): StackScreenOptions {
  const [background, foreground, accent] = useThemeColor(['background', 'foreground', 'accent']);
  return {
    headerShown: false,
    headerStyle: { backgroundColor: background },
    headerTintColor: accent,
    headerTitleStyle: { color: foreground },
    headerLargeTitleStyle: { color: foreground },
    headerShadowVisible: false,
    headerBackButtonDisplayMode: 'minimal',
    contentStyle: { backgroundColor: background },
  };
}
