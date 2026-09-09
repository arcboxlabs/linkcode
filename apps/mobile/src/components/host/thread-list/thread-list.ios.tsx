import { List, Section } from '@expo/ui/swift-ui';
import { listStyle, refreshable } from '@expo/ui/swift-ui/modifiers';
import type { ThreadListProps } from './thread-list.types';
import { ThreadRow } from './thread-row';
import { useThreadListState } from './use-thread-list-state';

/** The thread inbox body: one collapsible section per group. Grouping is decided by the
 *  caller — this only renders it.
 *
 *  `sidebar` is not cosmetic — SwiftUI only honours a `Section`'s expanded state under that list
 *  style, so it is what makes the groups collapsible at all. */
export function ThreadList({
  groups,
  labelFor,
  onOpenThread,
  onRefresh,
}: ThreadListProps): React.ReactNode {
  const { collapsed, setGroupExpanded, now } = useThreadListState();

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
              now={now}
              onPress={() => onOpenThread(session.sessionId)}
            />
          ))}
        </Section>
      ))}
    </List>
  );
}
