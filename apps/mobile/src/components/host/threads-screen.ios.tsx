import {
  Form,
  Host,
  ProgressView,
  Section,
  Button as UIButton,
  Text as UIText,
} from '@expo/ui/swift-ui';
import { SECONDARY } from '@mobile/components/form/styles.ios';
import { ThreadList } from '@mobile/components/host/thread-list/thread-list';
import { useThreadInbox } from '@mobile/components/host/use-thread-inbox';
import { Stack, useRouter } from 'expo-router';
import { useTranslations } from 'use-intl';

/** Threads inbox body: grouped sessions under collapsible headers, with the native search bar
 * stacked below the navigation bar. */
export function ThreadsScreen(): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  const router = useRouter();
  const { loading, groups, hasQuery, onSearchChange, groupLabel, onRefresh } = useThreadInbox();

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
          <Form>
            <Section>
              <ProgressView />
            </Section>
          </Form>
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
