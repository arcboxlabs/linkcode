import { List, Section } from '@expo/ui/swift-ui';
import { listStyle, refreshable } from '@expo/ui/swift-ui/modifiers';
import type { SessionInfo } from '@linkcode/schema';
import type { ThreadGroup } from '@linkcode/ui/native';
import { useState } from 'react';
import { ThreadRow } from './thread-row';

/** The thread inbox body: one collapsible section per group. Grouping is decided by the
 *  caller — this only renders it. Collapsed keys live here because the state is presentational:
 *  nothing outside the list cares which groups are open.
 *
 *  `sidebar` is not cosmetic — SwiftUI only honours a `Section`'s expanded state under that list
 *  style, so it is what makes the groups collapsible at all. */
export function ThreadList({
  groups,
  labelFor,
  onOpenThread,
  onRefresh,
}: {
  groups: ThreadGroup[];
  labelFor: (group: ThreadGroup) => string;
  onOpenThread: (sessionId: SessionInfo['sessionId']) => void;
  /** Drives SwiftUI's own pull-to-refresh, which holds its spinner until this resolves. */
  onRefresh: () => Promise<void>;
}): React.ReactNode {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const setGroupExpanded = (key: string, expanded: boolean) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (expanded) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <List modifiers={[listStyle('sidebar'), refreshable(onRefresh)]}>
      {groups.map((group) => (
        <Section
          key={group.key}
          title={labelFor(group)}
          isExpanded={!collapsed.has(group.key)}
          onIsExpandedChange={(expanded) => setGroupExpanded(group.key, expanded)}
        >
          {group.sessions.map((session) => (
            <ThreadRow
              key={session.sessionId}
              session={session}
              onPress={() => onOpenThread(session.sessionId)}
            />
          ))}
        </Section>
      ))}
    </List>
  );
}
