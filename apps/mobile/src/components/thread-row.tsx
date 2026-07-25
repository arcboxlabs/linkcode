import type { SessionInfo } from '@linkcode/schema';
import { AGENT_LABELS, AgentIcon, repositoryLabel } from '@linkcode/ui/native';
import { Pressable, Text } from 'react-native';
import { SessionStatusDot } from './session-status-dot';

/** One thread row: agent glyph, title (desktop-matching fallback), status dot. Deliberately
 * plain — the reference lists threads as bare lines, so the row carries no card of its own and
 * no timestamp; recency is already implied by the order within a group. */
export function ThreadRow({
  session,
  onPress,
}: {
  session: SessionInfo;
  onPress: () => void;
}): React.ReactNode {
  const title = session.title ?? `${AGENT_LABELS[session.kind]} in ${repositoryLabel(session.cwd)}`;

  return (
    <Pressable
      accessibilityRole="button"
      className="flex-row items-center gap-2.5 py-2.5"
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.5 } : undefined)}
    >
      <AgentIcon kind={session.kind} variant="ghost" size={16} />
      <Text className="min-w-0 flex-1 text-body text-foreground" numberOfLines={1}>
        {title}
      </Text>
      <SessionStatusDot status={session.status} />
    </Pressable>
  );
}
