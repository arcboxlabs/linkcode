import { HeaderIconButton } from '@mobile/components/shell/header-icon-button';
import { USES_IOS_26_NAVIGATION } from '@mobile/components/shell/ios-26-navigation';
import type { PrimaryAction } from '@mobile/components/shell/primary-action';
import type { NativeStackHeaderItem, NativeStackNavigationOptions } from 'expo-router';
import { useRouter } from 'expo-router';
import { EllipsisIcon } from 'lucide-react-native';
import { Platform, View } from 'react-native';
import { useTranslations } from 'use-intl';

type TrailingHeaderOptions = Pick<
  NativeStackNavigationOptions,
  'headerRight' | 'unstable_headerRightItems'
>;

/** Trailing navigation-bar chrome for the tab screens: on iOS the screen's primary action —
 * except on iOS 26, whose tab-bar slot already carries it — then the overflow menu that leads to
 * Settings. Native bar items are iOS-only; Android keeps an RN overflow button and carries the
 * primary action as a floating action button instead (`PrimaryActionFab`). */
export function useTrailingActions(primary: PrimaryAction | null): TrailingHeaderOptions {
  const t = useTranslations('mobile.settings');
  const router = useRouter();

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
      <View className="flex-row">
        <HeaderIconButton
          icon={EllipsisIcon}
          label={t('more')}
          onPress={() => router.push('/settings')}
        />
      </View>
    ),
  };
}
