import { Button, Text } from '@expo/ui/jetpack-compose';
import { padding } from '@expo/ui/jetpack-compose/modifiers';
import { FormList } from '@mobile/components/form/list.android';
import { FormHint, FormLoadingRow } from '@mobile/components/form/rows.android';
import { FormSection } from '@mobile/components/form/section.android';
import { ThreadList } from '@mobile/components/host/thread-list/thread-list';
import { useThreadInbox } from '@mobile/components/host/use-thread-inbox';
import { Stack, useRouter } from 'expo-router';
import { useTranslations } from 'use-intl';

/** Android threads inbox body. The search bar is the toolbar's collapsing magnifier field —
 * the iOS-only placement props are left off. */
export function ThreadsScreen(): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  const router = useRouter();
  const { loading, groups, hasQuery, onSearchChange, groupLabel, onRefresh } = useThreadInbox();

  return (
    <>
      <Stack.SearchBar
        placeholder={t('searchPlaceholder')}
        autoCapitalize="none"
        onChangeText={onSearchChange}
      />
      {loading ? (
        <FormList>
          <FormLoadingRow />
        </FormList>
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
