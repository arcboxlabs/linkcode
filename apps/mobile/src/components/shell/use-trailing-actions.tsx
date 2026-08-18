import { HeaderMenuButton } from '@mobile/components/shell/header-menu-button';
import { USES_IOS_26_NAVIGATION } from '@mobile/components/shell/ios-26-navigation';
import type { PrimaryAction } from '@mobile/components/shell/primary-action';
import { useNativePalette } from '@mobile/components/theme/native-palette';
import type { NativeStackHeaderItem, NativeStackNavigationOptions } from 'expo-router';
import { useRouter } from 'expo-router';
import { SearchIcon } from 'lucide-react-native';
import { Platform, Pressable, View } from 'react-native';
import { useTranslations } from 'use-intl';

type TrailingHeaderOptions = Pick<
  NativeStackNavigationOptions,
  'headerRight' | 'unstable_headerRightItems'
>;

/** Trailing navigation-bar chrome for the tab screens: on iOS the screen's primary action —
 * except on iOS 26, whose tab-bar slot already carries it — then the overflow menu that leads to
 * Settings. Native bar items are iOS-only; Android renders the overflow as a Compose
 * `DropdownMenu` (right-most) and carries the primary action as a floating action button
 * (`PrimaryActionFab`). `onSearchPress` adds an Android search toggle before the overflow — iOS
 * search lives in the native search bar instead. */
export function useTrailingActions(
  primary: PrimaryAction | null,
  { onSearchPress }: { onSearchPress?: () => void } = {},
): TrailingHeaderOptions {
  const t = useTranslations('mobile.settings');
  const tSessions = useTranslations('mobile.sessions');
  const router = useRouter();
  const palette = useNativePalette();

  if (Platform.OS === 'ios') {
    const items: NativeStackHeaderItem[] = [];
    if (!USES_IOS_26_NAVIGATION && primary) {
      items.push({
        type: 'button',
        label: primary.label,
        icon: { type: 'sfSymbol', name: primary.sf },
        onPress: primary.onPress,
      });
    }
    items.push({
      type: 'menu',
      label: t('more'),
      icon: { type: 'sfSymbol', name: 'ellipsis' },
      menu: {
        items: [
          {
            type: 'action',
            label: t('title'),
            icon: { type: 'sfSymbol', name: 'gearshape' },
            onPress: () => router.push('/settings'),
          },
        ],
      },
    });
    return { unstable_headerRightItems: () => items };
  }

  return {
    headerRight: () => (
      <View className="flex-row items-center">
        {onSearchPress ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tSessions('searchPlaceholder')}
            hitSlop={8}
            onPress={onSearchPress}
            className="h-9 w-9 items-center justify-center"
            style={({ pressed }) => ({ opacity: pressed ? 0.4 : 1 })}
          >
            <SearchIcon size={21} color={palette.text} strokeWidth={2} />
          </Pressable>
        ) : null}
        <HeaderMenuButton
          label={t('more')}
          actions={[{ id: 'settings', label: t('title'), onPress: () => router.push('/settings') }]}
        />
      </View>
    ),
  };
}
