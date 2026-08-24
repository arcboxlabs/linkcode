import { Form, Host, Section, Button as UIButton, Text as UIText } from '@expo/ui/swift-ui';
import { LoadingView } from '@mobile/components/form/loading-view.ios';
import { SECONDARY } from '@mobile/components/form/styles.ios';
import { ThreadList } from '@mobile/components/host/thread-list/thread-list';
import { useThreadInbox } from '@mobile/components/host/use-thread-inbox';
import { Stack, useRouter } from 'expo-router';
import { noop } from 'foxact/noop';
import { useCallback } from 'react';
import { useTranslations } from 'use-intl';

/** Taken from the search bar itself: RN's own replacement for the event it declares carries no text. */
type SearchBarChangeEvent = Parameters<
  NonNullable<React.ComponentProps<typeof Stack.SearchBar>['onChangeText']>
>[0];

/** Threads inbox body: grouped sessions under collapsible headers, with the native search bar
 * stacked below the navigation bar. The open/close props are the Android toggle; iOS search is
 * always available in the header and writes back into the route-owned query. */
export function ThreadsScreen({
  query = '',
  onQueryChange = noop,
}: {
  searchOpen?: boolean;
  onCloseSearch?: () => void;
  query?: string;
  onQueryChange?: (query: string) => void;
}): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  const router = useRouter();
  const { loading, groups, hasQuery, groupLabel, onRefresh } = useThreadInbox(query);

  // Stable so the search bar's options object survives a keystroke without re-registering.
  const onSearchChange = useCallback(
    (event: SearchBarChangeEvent) => onQueryChange(event.nativeEvent.text),
    [onQueryChange],
  );

  return (
    <>
      {/* `stacked` keeps the field below the inline title instead of moving into the iOS 26 toolbar. */}
      <Stack.SearchBar
        placeholder={t('searchPlaceholder')}
        placement="stacked"
        hideWhenScrolling
        hideNavigationBar={false}
        autoCapitalize="none"
        onChangeText={onSearchChange}
      />
      {/* The list needs the viewport as its proposed size, otherwise SwiftUI collapses it. */}
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {loading ? (
          <LoadingView />
        ) : groups.length === 0 ? (
          // A query that matched nothing is not an empty inbox: saying "no threads yet" there
          // reads as though the existing threads were lost, and offering to start one is no
          // remedy for a bad search.
          <Form>
            {hasQuery ? (
              <Section>
                <UIText modifiers={[SECONDARY]}>{t('searchEmpty')}</UIText>
              </Section>
            ) : (
              <Section footer={<UIText>{t('emptyHint')}</UIText>}>
                <UIText modifiers={[SECONDARY]}>{t('emptyTitle')}</UIText>
                <UIButton label={t('newThread')} onPress={() => router.push('/new-thread')} />
              </Section>
            )}
          </Form>
        ) : (
          <ThreadList
            groups={groups}
            labelFor={groupLabel}
            onOpenThread={(sessionId) => router.push(`/session/${sessionId}`)}
            onRefresh={onRefresh}
          />
        )}
      </Host>
    </>
  );
}
