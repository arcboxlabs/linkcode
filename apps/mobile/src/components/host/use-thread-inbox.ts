import { useSessions } from '@linkcode/client-core';
import type { ThreadGroup } from '@linkcode/ui/native';
import {
  groupThreadsByWorkspace,
  repositoryLabel,
  withoutAutomationSessions,
} from '@linkcode/ui/native';
import { threadTitle } from '@mobile/components/host/thread-list/thread-title';
import { useWorkspaces } from '@mobile/runtime/use-workspaces';
import type { Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslations } from 'use-intl';

/** Taken from the search bar itself: RN's own replacement for the event it declares carries no text. */
type SearchBarChangeEvent = Parameters<
  NonNullable<React.ComponentProps<typeof Stack.SearchBar>['onChangeText']>
>[0];

/** The threads inbox view model: sessions grouped by workspace, filtered by the search query.
 * Empty workspace groups are hidden — the new-thread page is where they surface. */
export function useThreadInbox(): {
  loading: boolean;
  groups: ThreadGroup[];
  hasQuery: boolean;
  onSearchChange: (event: SearchBarChangeEvent) => void;
  groupLabel: (group: ThreadGroup) => string;
  onRefresh: () => Promise<void>;
} {
  const t = useTranslations('mobile.sessions');
  const { sessions, refresh, loading } = useSessions();
  const { workspaces, refresh: refreshWorkspaces } = useWorkspaces();

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

  return { loading, groups, hasQuery: needle !== '', onSearchChange, groupLabel, onRefresh };
}
