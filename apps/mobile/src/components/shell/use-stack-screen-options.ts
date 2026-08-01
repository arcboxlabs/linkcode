import type { Stack } from 'expo-router';
import { useThemeColor } from 'heroui-native';
import { Platform } from 'react-native';
import { NavigationBarBackdrop } from '../../../modules/linkcode-navigation-bar-backdrop';

type StackScreenOptions = NonNullable<React.ComponentProps<typeof Stack>['screenOptions']>;

/** Theme-synced native-stack chrome; every Stack in the app spreads these defaults.
 * Screens opt into a header per route via `Stack.Screen` options. */
export function useStackScreenOptions({
  softHeaderEdge = false,
}: {
  softHeaderEdge?: boolean;
} = {}): StackScreenOptions {
  const [background, foreground, accent] = useThemeColor(['background', 'foreground', 'accent']);
  const usesSoftHeaderEdge =
    softHeaderEdge && Platform.OS === 'ios' && Number.parseInt(Platform.Version, 10) >= 26;

  return {
    headerShown: false,
    headerTintColor: accent,
    headerTitleStyle: { color: foreground },
    headerLargeTitleStyle: { color: foreground },
    headerStyle: { backgroundColor: 'transparent' },
    // A native header blur covers iOS 26's soft scroll edge, so tab stacks mask the material themselves.
    ...(usesSoftHeaderEdge
      ? {
          headerBackground: NavigationBarBackdrop,
          headerTransparent: true,
          scrollEdgeEffects: {
            top: 'soft' as const,
          },
        }
      : {
          headerBlurEffect: 'systemChromeMaterial' as const,
        }),
    headerShadowVisible: false,
    headerBackButtonDisplayMode: 'minimal',
    contentStyle: { backgroundColor: background },
  };
}
