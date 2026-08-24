import { Button, Text } from '@expo/ui/jetpack-compose';
import { padding } from '@expo/ui/jetpack-compose/modifiers';
import { FormList } from '@mobile/components/form/list.android';
import { LoadingView } from '@mobile/components/form/loading-view.android';
import { FormHint } from '@mobile/components/form/rows.android';
import { FormSection } from '@mobile/components/form/section.android';
import { ThreadList } from '@mobile/components/host/thread-list/thread-list';
import { useThreadInbox } from '@mobile/components/host/use-thread-inbox';
import { useRouter } from 'expo-router';
import { noop } from 'foxact/noop';
import { useEffect } from 'react';
import { BackHandler } from 'react-native';
import { useTranslations } from 'use-intl';

/** Android threads inbox body. The search field lives in the route's header (the M3 search view
 * swaps the top app bar's content via `useSearchHeaderOptions`); this screen only filters by the
 * route-owned query and collapses the search on hardware back. */
export function ThreadsScreen({
  searchOpen = false,
  onCloseSearch = noop,
  query = '',
}: {
  searchOpen?: boolean;
  onCloseSearch?: () => void;
  query?: string;
  onQueryChange?: (query: string) => void;
}): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  const router = useRouter();
  const { loading, groups, hasQuery, groupLabel, onRefresh } = useThreadInbox(query);

  // The hardware back gesture collapses the search first, as every Android search view does.
  useEffect(() => {
    if (!searchOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onCloseSearch();
      return true;
    });
    return () => subscription.remove();
  }, [searchOpen, onCloseSearch]);

  return (
    <>
      {loading ? (
        <LoadingView />
      ) : groups.length === 0 ? (
        // A query that matched nothing is not an empty inbox: saying "no threads yet" there
        // reads as though the existing threads were lost, and offering to start one is no
        // remedy for a bad search.
        <FormList>
          {hasQuery ? (
            <FormHint>{t('searchEmpty')}</FormHint>
          ) : (
            <FormSection footer={t('emptyHint')}>
              <FormHint>{t('emptyTitle')}</FormHint>
              <Button
                onClick={() => router.push('/new-thread')}
                modifiers={[padding(16, 4, 16, 4)]}
              >
                <Text>{t('newThread')}</Text>
              </Button>
            </FormSection>
          )}
        </FormList>
      ) : (
        <ThreadList
          groups={groups}
          labelFor={groupLabel}
          onOpenThread={(sessionId) => router.push(`/session/${sessionId}`)}
          onRefresh={onRefresh}
        />
      )}
    </>
  );
}
