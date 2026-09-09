import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { useNativePalette } from '@mobile/components/theme/native-palette';
import type { NativeStackNavigationOptions } from 'expo-router';
import { ArrowLeftIcon } from 'lucide-react-native';
import { Pressable, TextInput, View } from 'react-native';

/** Header options that swap the top app bar's content for a full-width M3 search view while
 * `open` — the classic Android search pattern. Spread LAST into the screen's options, after the
 * usual leading/trailing header options. The search renders as the toolbar's center view (full
 * width on Android) so the toolbar itself never unmounts: hiding the native header and mounting
 * an in-content bar land on different frames and flicker. Every key is set in both states with
 * explicit undefined where cleared: expo-router applies options via `setOptions`, a shallow
 * merge, so an omitted key would keep its stale value. On iOS this is a no-op — search lives in
 * the native search bar. */
export function useSearchHeaderOptions({
  open,
  placeholder,
  closeLabel,
  onQueryChange,
  onClose,
}: {
  open: boolean;
  placeholder: string;
  /** Accessibility name of the leading back arrow. */
  closeLabel: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
}): Partial<NativeStackNavigationOptions> {
  const colors = useAppMaterialColors();
  const palette = useNativePalette();

  // Closed restores the navigator's Android header color rather than clearing: `setOptions`
  // merges per key, so `undefined` would override the stack default down to the theme's white.
  if (!open) {
    return { headerTitle: undefined, headerStyle: { backgroundColor: palette.background } };
  }
  return {
    headerLeft: undefined,
    headerRight: undefined,
    headerStyle: { backgroundColor: colors.surfaceContainerHigh },
    headerTitle: () => (
      <View className="flex-1 flex-row items-center gap-1">
        {/* Pulls the arrow out of the toolbar's 16dp content inset to the nav-icon position. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          hitSlop={8}
          onPress={onClose}
          className="h-12 w-12 items-center justify-center"
          style={{ marginStart: -12 }}
        >
          <ArrowLeftIcon size={22} color={colors.onSurface} />
        </Pressable>
        <TextInput
          autoFocus
          className="flex-1 text-body"
          style={{ color: colors.onSurface }}
          placeholder={placeholder}
          placeholderTextColor={colors.onSurfaceVariant}
          cursorColor={colors.primary}
          onChangeText={onQueryChange}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>
    ),
  };
}
