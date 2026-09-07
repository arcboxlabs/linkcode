import { useSessions } from '@linkcode/client-core';
import type { ThreadGroup } from '@linkcode/ui/native';
import {
  groupThreadsByWorkspace,
  repositoryLabel,
  withoutAutomationSessions,
} from '@linkcode/ui/native';
import { useWorkspaces } from '@mobile/runtime/use-workspaces';
import { threadTitle } from '@mobile/utils/thread-title';
import { useTranslations } from 'use-intl';

/** The threads inbox view model: sessions grouped by workspace, filtered by the search query.
 * The query is owned by the route — on Android it feeds the toolbar search field, on iOS the
 * native search bar. Empty workspace groups are hidden — the new-thread page is where they
 * surface. */
export function useThreadInbox(query: string): {
  loading: boolean;
  groups: ThreadGroup[];
  hasQuery: boolean;
  groupLabel: (group: ThreadGroup) => string;
  onRefresh: () => Promise<void>;
} {
  const t = useTranslations('mobile.sessions');
  const { sessions, refresh, loading } = useSessions();
  const { workspaces, refresh: refreshWorkspaces } = useWorkspaces();

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

  return { loading, groups, hasQuery: needle !== '', groupLabel, onRefresh };
}
