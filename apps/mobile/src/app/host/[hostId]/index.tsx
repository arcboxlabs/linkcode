import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useSessions } from '@linkcode/client-core';
import type { AgentKind } from '@linkcode/schema';
import type { ThreadGroup } from '@linkcode/ui/native';
import {
  EmptyState,
  groupThreadsByWorkspace,
  repositoryLabel,
  ScreenScroll,
  SectionLabel,
  withoutAutomationSessions,
} from '@linkcode/ui/native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Button, ListGroup, Spinner, useThemeColor } from 'heroui-native';
import { MessagesSquareIcon, SquareTerminalIcon } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { HostBar } from '../../../components/host-bar';
import { HeaderIconButton } from '../../../components/navigation';
import { NewThreadSheet } from '../../../components/new-thread-sheet';
import { ThreadRow } from '../../../components/thread-row';
import { useWorkspaces } from '../../../runtime/use-workspaces';
import { useHostRegistryStore } from '../../../stores/host-store';

/** Threads inbox: sessions grouped by workspace (project), a bottom host bar, and the
 * new-thread sheet. Empty workspace groups are hidden — the sheet is where they surface. */
export default function ThreadsScreen(): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  const router = useRouter();
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const { sessions, create, refresh, loading } = useSessions();
  const { workspaces, refresh: refreshWorkspaces } = useWorkspaces();
  const host = useHostRegistryStore((state) => state.hosts.find((entry) => entry.id === hostId));
  const muted = useThemeColor('muted');
  const sheetRef = useRef<BottomSheetModal>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);

  const groups = groupThreadsByWorkspace(withoutAutomationSessions(sessions), workspaces).filter(
    (group) => group.sessions.length > 0,
  );

  const groupLabel = (group: ThreadGroup): string => {
    if (group.isChat) return t('chats');
    if (!group.workspace) return t('otherThreads');
    return group.workspace.name ?? repositoryLabel(group.workspace.cwd);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refresh(), refreshWorkspaces()]);
    } finally {
      setRefreshing(false);
    }
  };

  const onCreate = async (kind: AgentKind, cwd: string) => {
    if (creating) return;
    setCreating(true);
    try {
      const sessionId = await create({ kind, cwd });
      await refreshWorkspaces();
      sheetRef.current?.dismiss();
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
            <HeaderIconButton
              icon={SquareTerminalIcon}
              label={t('terminals')}
              onPress={() => router.push(`/host/${hostId}/terminal`)}
            />
          ),
        }}
      />
      <ScreenScroll
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loading ? (
          <View className="items-center py-8">
            <Spinner />
          </View>
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<MessagesSquareIcon size={36} color={muted} strokeWidth={1.5} />}
            title={t('emptyTitle')}
            hint={t('emptyHint')}
            action={
              <Button size="sm" onPress={() => sheetRef.current?.present()}>
                <Button.Label>{t('newThread')}</Button.Label>
              </Button>
            }
          />
        ) : (
          groups.map((group) => (
            <View key={group.key} className="gap-2">
              <SectionLabel>{groupLabel(group)}</SectionLabel>
              <ListGroup>
                {group.sessions.map((session) => (
                  <ThreadRow
                    key={session.sessionId}
                    session={session}
                    onPress={() => router.push(`/host/${hostId}/session/${session.sessionId}`)}
                  />
                ))}
              </ListGroup>
            </View>
          ))
        )}
      </ScreenScroll>
      <HostBar
        hostName={host?.name ?? ''}
        onNewThread={() => sheetRef.current?.present()}
        onOpenSettings={() => router.push('/settings')}
      />
      <NewThreadSheet
        ref={sheetRef}
        workspaces={workspaces}
        creating={creating}
        onCreate={onCreate}
      />
    </View>
  );
}
