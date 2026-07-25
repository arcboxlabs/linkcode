import type { SessionInfo } from '@linkcode/schema';
import type { ThreadGroup } from '@linkcode/ui/native';
import { ListGroup, useThemeColor } from 'heroui-native';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ThreadRow } from './thread-row';

/** A group header that folds its threads away. Collapsed keys live here because the state is
 *  presentational — nothing outside the list cares which groups are open. */
function CollapsibleGroup({
  label,
  collapsed,
  onToggle,
  children,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): React.ReactNode {
  const muted = useThemeColor('muted');
  const Chevron = collapsed ? ChevronRightIcon : ChevronDownIcon;

  return (
    <View className="gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        className="flex-row items-center gap-1 self-start"
        hitSlop={6}
        onPress={onToggle}
      >
        <Text className="font-semibold text-foreground text-subhead">{label}</Text>
        <Chevron size={15} color={muted} />
      </Pressable>
      {collapsed ? null : children}
    </View>
  );
}

/** The thread inbox body: one collapsible section per group. Grouping is decided by the
 *  caller — this only renders it. */
export function ThreadList({
  groups,
  labelFor,
  onOpenThread,
}: {
  groups: ThreadGroup[];
  labelFor: (group: ThreadGroup) => string;
  onOpenThread: (sessionId: SessionInfo['sessionId']) => void;
}): React.ReactNode {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <View className="gap-5">
      {groups.map((group) => (
        <CollapsibleGroup
          key={group.key}
          label={labelFor(group)}
          collapsed={collapsed.has(group.key)}
          onToggle={() => toggle(group.key)}
        >
          <ListGroup>
            {group.sessions.map((session) => (
              <ThreadRow
                key={session.sessionId}
                session={session}
                onPress={() => onOpenThread(session.sessionId)}
              />
            ))}
          </ListGroup>
        </CollapsibleGroup>
      ))}
    </View>
  );
}
