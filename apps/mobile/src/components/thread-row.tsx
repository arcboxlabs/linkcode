import type { SessionInfo } from '@linkcode/schema';
import { AGENT_LABELS, AgentIcon, repositoryLabel } from '@linkcode/ui/native';
import { ListGroup } from 'heroui-native';
import { formatRelativeShort } from '../utils/relative-time';
import { SessionStatusDot } from './session-status-dot';

/** One thread row: agent glyph, title (desktop-matching fallback), recency, status dot. */
export function ThreadRow({
  session,
  onPress,
}: {
  session: SessionInfo;
  onPress: () => void;
}): React.ReactNode {
  const title = session.title ?? `${AGENT_LABELS[session.kind]} in ${repositoryLabel(session.cwd)}`;

  return (
    <ListGroup.Item onPress={onPress}>
      <ListGroup.ItemPrefix>
        <AgentIcon kind={session.kind} variant="ghost" size={20} />
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle numberOfLines={1}>{title}</ListGroup.ItemTitle>
        <ListGroup.ItemDescription>
          {formatRelativeShort(session.updatedAt)}
        </ListGroup.ItemDescription>
      </ListGroup.ItemContent>
      <ListGroup.ItemSuffix>
        <SessionStatusDot status={session.status} />
      </ListGroup.ItemSuffix>
    </ListGroup.Item>
  );
}
