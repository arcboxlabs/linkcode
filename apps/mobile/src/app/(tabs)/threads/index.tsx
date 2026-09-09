import { useSearchHeaderOptions } from '@mobile/components/form/use-search-header-options';
import { HostClientGate } from '@mobile/components/host/host-client-gate';
import { ThreadsScreen } from '@mobile/components/host/threads-screen';
import { useHostHeaderOptions } from '@mobile/components/host/use-host-header-options';
import type { PrimaryAction } from '@mobile/components/shell/primary-action';
import { usePrimaryAction } from '@mobile/components/shell/primary-action';
import { PrimaryActionFab } from '@mobile/components/shell/primary-action-fab';
import { VISIBLE_HEADER_OPTIONS } from '@mobile/components/shell/use-stack-screen-options';
import { useTrailingActions } from '@mobile/components/shell/use-trailing-actions';
import { useNativePalette } from '@mobile/components/theme/native-palette';
import { useHostConnection } from '@mobile/runtime/host-connection';
import { Stack, useRouter } from 'expo-router';
import { SquarePenIcon } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Platform, View } from 'react-native';
import { useTranslations } from 'use-intl';

/** The header outlives the connection: it carries the host switcher, which is the way out of a host
 * that cannot be reached, so it is mounted above the gate rather than inside it. New-thread needs a
 * client, so its entry points are dropped until the connection is ready. */
export default function ThreadsRoute(): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  const tChat = useTranslations('mobile.chat');
  const router = useRouter();
  const hostHeaderOptions = useHostHeaderOptions();
  const palette = useNativePalette();
  const connection = useHostConnection();
  // Android-only affordance: iOS search lives in the screen's native search bar instead.
  const [searchOpen, setSearchOpen] = useState(false);
  // Toggling the search resets the filter: the field remounts empty, so the query must too.
  const [query, setQuery] = useState('');
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
  }, []);

  const primaryAction: PrimaryAction | null =
    connection?.status === 'ready'
      ? {
          sf: 'square.and.pencil',
          icon: SquarePenIcon,
          label: t('newThread'),
          onPress: () => router.push('/new-thread'),
        }
      : null;
  usePrimaryAction('threads', primaryAction);
  const trailingActions = useTrailingActions(primaryAction, {
    ...(Platform.OS === 'android' && {
      onSearchPress() {
        setQuery('');
        setSearchOpen((open) => !open);
      },
    }),
  });
  const searchHeaderOptions = useSearchHeaderOptions({
    open: searchOpen,
    placeholder: t('searchPlaceholder'),
    closeLabel: tChat('cancel'),
    onQueryChange: setQuery,
    onClose: closeSearch,
  });

  return (
    <View className="flex-1" style={{ backgroundColor: palette.background }}>
      <Stack.Screen
        options={{
          ...VISIBLE_HEADER_OPTIONS,
          title: t('title'),
          ...hostHeaderOptions,
          ...trailingActions,
          // The search view swaps the top app bar's content, replacing the switcher and actions;
          // the toolbar itself stays mounted so the header never changes height (no flicker).
          ...searchHeaderOptions,
        }}
      />
      <HostClientGate>
        <ThreadsScreen
          searchOpen={searchOpen}
          onCloseSearch={closeSearch}
          query={query}
          onQueryChange={setQuery}
        />
      </HostClientGate>
      <PrimaryActionFab action={primaryAction} />
    </View>
  );
}
