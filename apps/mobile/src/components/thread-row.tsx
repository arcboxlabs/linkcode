import { HStack, Image, Spacer, Text } from '@expo/ui/swift-ui';
import {
  contentShape,
  foregroundStyle,
  lineLimit,
  onTapGesture,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import type { SessionInfo, SessionStatus } from '@linkcode/schema';
import { AGENT_LABELS, repositoryLabel } from '@linkcode/ui/native';

/** SwiftUI's semantic colours standing in for the `bg-*` tokens the RN dot used. */
const STATUS_COLOR = {
  starting: 'orange',
  idle: 'gray',
  running: 'green',
  'awaiting-input': 'orange',
  stopped: 'secondary',
} as const satisfies Record<SessionStatus, string>;

const WHOLE_ROW = contentShape(shapes.rectangle());

/** One thread row: title (desktop-matching fallback) and a status dot. Deliberately plain — the
 * reference lists threads as bare lines, so the row carries no timestamp and no agent glyph;
 * recency is implied by the order within a group, and the fallback title already names the agent.
 * (An agent glyph would have to be an SF Symbol here: the brand marks are RN SVG components.) */
export function ThreadRow({
  session,
  onPress,
}: {
  session: SessionInfo;
  onPress: () => void;
}): React.ReactNode {
  const title = session.title ?? `${AGENT_LABELS[session.kind]} in ${repositoryLabel(session.cwd)}`;

  return (
    <HStack spacing={10} modifiers={[WHOLE_ROW, onTapGesture(onPress)]}>
      <Text modifiers={[lineLimit(1)]}>{title}</Text>
      <Spacer />
      <Image
        systemName="circle.fill"
        size={8}
        modifiers={[foregroundStyle(STATUS_COLOR[session.status])]}
      />
    </HStack>
  );
}
