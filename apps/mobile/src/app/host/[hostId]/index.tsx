import {
  Form,
  Host,
  ProgressView,
  Section,
  Button as UIButton,
  Text as UIText,
} from '@expo/ui/swift-ui';
import { foregroundStyle } from '@expo/ui/swift-ui/modifiers';
import { useSessions } from '@linkcode/client-core';
import type { AgentKind, SessionId, SessionInfo } from '@linkcode/schema';
import type { ThreadGroup } from '@linkcode/ui/native';
import {
  AGENT_LABELS,
  groupThreadsByWorkspace,
  repositoryLabel,
  withoutAutomationSessions,
} from '@linkcode/ui/native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SearchField, useThemeColor } from 'heroui-native';
import { SettingsIcon, SquarePenIcon, SquareTerminalIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { HeaderIconButton } from '../../../components/navigation';
import { NewThreadSheet } from '../../../components/new-thread-sheet';
import { ThreadList } from '../../../components/thread-list';
import { captureMobileProductEvent } from '../../../runtime/product-analytics';
import { useWorkspaces } from '../../../runtime/use-workspaces';
import { useHostRegistryStore } from '../../../stores/host-store';

/** The title a thread is listed and searched under — the same fallback the row renders. */
function threadTitle(session: SessionInfo): string {
  return session.title ?? `${AGENT_LABELS[session.kind]} in ${repositoryLabel(session.cwd)}`;
}

/** Threads inbox: sessions grouped by workspace (project) under collapsible headers, the
 * connected host as a subtitle, and a search + new-thread footer. Empty workspace groups are
 * hidden — the sheet is where they surface. */
export default function ThreadsScreen(): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  const router = useRouter();
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const { sessions, create, refresh, loading } = useSessions();
  const { workspaces, refresh: refreshWorkspaces } = useWorkspaces();
  const host = useHostRegistryStore((state) => state.hosts.find((entry) => entry.id === hostId));
  const [background, foreground] = useThemeColor(['background', 'foreground']);
  const insets = useSafeAreaInsets();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');

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
      router.push(`/host/${hostId}/session/${sessionId}`);
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
            <View className="flex-row items-center">
              <HeaderIconButton
                icon={SquareTerminalIcon}
                label={t('terminals')}
                onPress={() => router.push(`/host/${hostId}/terminal`)}
              />
              <HeaderIconButton
                icon={SettingsIcon}
                label={t('settings')}
                onPress={() => router.push('/settings')}
              />
            </View>
          ),
        }}
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
          <Form>
            <Section footer={<UIText>{t('emptyHint')}</UIText>}>
              <UIText modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
                {t('emptyTitle')}
              </UIText>
              <UIButton label={t('newThread')} onPress={() => setSheetOpen(true)} />
            </Section>
          </Form>
        ) : (
          <ThreadList
            groups={groups}
            labelFor={groupLabel}
            onOpenThread={(sessionId) => router.push(`/host/${hostId}/session/${sessionId}`)}
            onRefresh={onRefresh}
          />
        )}
      </Host>
      <View
        className="flex-row items-center gap-2 px-5 pt-2"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
      >
        <SearchField className="min-w-0 flex-1" value={query} onChange={setQuery}>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder={t('searchPlaceholder')} returnKeyType="search" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        {/* Inverted rather than accent-tinted, matching the reference's near-black pill;
            the token pair flips with the colour scheme so it stays legible in dark mode. */}
        <Pressable
          accessibilityRole="button"
          className="flex-row items-center gap-1.5 rounded-full px-4 py-2.5"
          onPress={() => setSheetOpen(true)}
          style={({ pressed }) => ({ backgroundColor: foreground, opacity: pressed ? 0.7 : 1 })}
        >
          <SquarePenIcon size={15} color={background} />
          <Text className="font-medium text-subhead" style={{ color: background }}>
            {t('newThread')}
          </Text>
        </Pressable>
      </View>
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
