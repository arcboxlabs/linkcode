import {
  Form,
  Host,
  ProgressView,
  Section,
  Button as UIButton,
  Text as UIText,
} from '@expo/ui/swift-ui';
import { useSessions } from '@linkcode/client-core';
import type { AgentKind, SessionId, SessionInfo } from '@linkcode/schema';
import type { ThreadGroup } from '@linkcode/ui/native';
import {
  AGENT_LABELS,
  groupThreadsByWorkspace,
  repositoryLabel,
  withoutAutomationSessions,
} from '@linkcode/ui/native';
import { SECONDARY } from '@mobile/components/form/styles';
import { NewThreadSheet } from '@mobile/components/host/new-thread-sheet';
import { ThreadList } from '@mobile/components/host/thread-list/thread-list';
import { HeaderIconButton } from '@mobile/components/shell/header-icon-button';
import { captureMobileProductEvent } from '@mobile/runtime/product-analytics';
import { useWorkspaces } from '@mobile/runtime/use-workspaces';
import { useSelectedHost } from '@mobile/stores/host-store';
import { Stack, useRouter } from 'expo-router';
import { SquarePenIcon } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslations } from 'use-intl';

/** Taken from the search bar itself: RN's own replacement for the event it declares carries no text. */
type SearchBarChangeEvent = Parameters<
  NonNullable<React.ComponentProps<typeof Stack.SearchBar>['onChangeText']>
>[0];

/** The title a thread is listed and searched under — the same fallback the row renders. */
function threadTitle(session: SessionInfo): string {
  return session.title ?? `${AGENT_LABELS[session.kind]} in ${repositoryLabel(session.cwd)}`;
}

/** Threads inbox: sessions grouped by workspace (project) under collapsible headers, the
 * connected host as a subtitle, and the native search bar stacked under the large title. Empty
 * workspace groups are hidden — the sheet is where they surface. */
export default function ThreadsScreen(): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  const router = useRouter();
  const { sessions, create, refresh, loading } = useSessions();
  const { workspaces, refresh: refreshWorkspaces } = useWorkspaces();
  const host = useSelectedHost();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');

  // Stable so the search bar's options object survives a keystroke without re-registering.
  const onSearchChange = useCallback(
    (event: SearchBarChangeEvent) => setQuery(event.nativeEvent.text),
    [],
  );

  const needle = query.trim().toLowerCase();
  const groups = groupThreadsByWorkspace(withoutAutomationSessions(sessions), workspaces).reduce<
    ThreadGroup[]
  >((kept, group) => {
    const matched =
      needle === ''
        ? group.sessions
        : group.sessions.filter((session) => threadTitle(session).toLowerCase().includes(needle));
    if (matched.length > 0) kept.push({ ...group, sessions: matched });
    return kept;
  }, []);

  const groupLabel = (group: ThreadGroup): string => {
    if (group.isChat) return t('chats');
    if (!group.workspace) return t('otherThreads');
    return group.workspace.name ?? repositoryLabel(group.workspace.cwd);
  };

  const onRefresh = async () => {
    await Promise.all([refresh(), refreshWorkspaces()]);
  };

  const onCreate = async (kind: AgentKind, cwd: string) => {
    if (creating) return;
    const startedAt = Date.now();
    setCreating(true);
    try {
      let sessionId: SessionId;
      try {
        sessionId = await create({ kind, cwd });
        captureMobileProductEvent('thread created', {
          agent_kind: kind,
          duration_ms: Date.now() - startedAt,
        });
      } catch (error) {
        captureMobileProductEvent('thread create failed', {
          agent_kind: kind,
          duration_ms: Date.now() - startedAt,
        });
        throw error;
      }
      await refreshWorkspaces();
      setSheetOpen(false);
      router.push(`/session/${sessionId}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          headerShown: true,
          headerLargeTitle: true,
          title: t('title'),
          headerRight: () => (
            <HeaderIconButton
              icon={SquarePenIcon}
              label={t('newThread')}
              onPress={() => setSheetOpen(true)}
            />
          ),
        }}
      />
      {/* `stacked` keeps the field under the large title instead of collapsing into the iOS 26
          toolbar; the screen body is a SwiftUI host, so nothing here can drive hide-on-scroll. */}
      <Stack.SearchBar
        placeholder={t('searchPlaceholder')}
        placement="stacked"
        hideWhenScrolling={false}
        hideNavigationBar={false}
        autoCapitalize="none"
        onChangeText={onSearchChange}
      />
      {/* The connected host reads as a subtitle of the screen, the way the reference puts the
          machine under its title, rather than as a separate bar pinned to the bottom. */}
      <View className="flex-row items-center gap-2 px-5 pb-2">
        <View className="h-2 w-2 rounded-full bg-success" />
        <Text className="min-w-0 flex-1 text-muted text-subhead" numberOfLines={1}>
          {host?.name ?? ''}
        </Text>
      </View>
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
            {needle === '' ? (
              <Section footer={<UIText>{t('emptyHint')}</UIText>}>
                <UIText modifiers={[SECONDARY]}>{t('emptyTitle')}</UIText>
                <UIButton label={t('newThread')} onPress={() => setSheetOpen(true)} />
              </Section>
            ) : (
              <Section>
                <UIText modifiers={[SECONDARY]}>{t('searchEmpty')}</UIText>
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
      <NewThreadSheet
        isPresented={sheetOpen}
        onIsPresentedChange={setSheetOpen}
        workspaces={workspaces}
        creating={creating}
        onCreate={onCreate}
      />
    </View>
  );
}
