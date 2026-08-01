import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  contentShape,
  foregroundStyle,
  lineLimit,
  onTapGesture,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import type { SessionInfo, SessionStatus } from '@linkcode/schema';
import { AGENT_LABELS, repositoryLabel } from '@linkcode/ui/native';
import { FOOTNOTE, SECONDARY, TERTIARY } from '@mobile/components/form/styles';
import { formatRelativeShort } from '@mobile/utils/relative-time';

/** SwiftUI's semantic colours standing in for the `bg-*` tokens the RN dot used. */
const STATUS_COLOR = {
  starting: 'orange',
  idle: 'gray',
  running: 'green',
  'awaiting-input': 'orange',
  stopped: 'secondary',
} as const satisfies Record<SessionStatus, string>;

const WHOLE_ROW = contentShape(shapes.rectangle());

/** One thread row: title (desktop-matching fallback), which agent is driving it and how long ago it
 * moved, then a status dot and the chevron `NavigationLink` would have drawn.
 *
 * The subtitle names the agent rather than the project because the list is already grouped by
 * project — repeating it there would spend the line on something the section header already says.
 * The agent is text, not a glyph: the brand marks are RN SVG components and cannot cross into
 * SwiftUI. */
export function ThreadRow({
  session,
  now,
  onPress,
}: {
  session: SessionInfo;
  now: number;
  onPress: () => void;
}): React.ReactNode {
  const title = session.title ?? `${AGENT_LABELS[session.kind]} in ${repositoryLabel(session.cwd)}`;
  const subtitle = `${AGENT_LABELS[session.kind]} · ${formatRelativeShort(session.updatedAt, now)}`;

  return (
    <HStack spacing={10} modifiers={[WHOLE_ROW, onTapGesture(onPress)]}>
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[lineLimit(1)]}>{title}</Text>
        <Text modifiers={[FOOTNOTE, SECONDARY, lineLimit(1)]}>{subtitle}</Text>
      </VStack>
      <Spacer />
      <Image
        systemName="circle.fill"
        size={8}
        modifiers={[foregroundStyle(STATUS_COLOR[session.status])]}
      />
      <Image systemName="chevron.right" size={13} modifiers={[TERTIARY]} />
    </HStack>
  );
}
