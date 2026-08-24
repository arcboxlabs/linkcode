import { HStack, Image, RNHostView, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  contentShape,
  foregroundStyle,
  lineLimit,
  onTapGesture,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import type { SessionStatus } from '@linkcode/schema';
import { AgentIcon } from '@linkcode/ui/native';
import { FOOTNOTE, SECONDARY, TERTIARY } from '@mobile/components/form/styles.ios';
import { useNativePalette } from '@mobile/components/theme/native-palette';
import { formatRelativeShort } from '@mobile/utils/relative-time';
import { View } from 'react-native';
import type { ThreadRowProps } from './thread-row.types';
import { threadTitle } from './thread-title';

/** SwiftUI's semantic colours standing in for the `bg-*` tokens the RN dot used. */
const STATUS_COLOR = {
  starting: 'orange',
  idle: 'gray',
  running: 'green',
  'awaiting-input': 'orange',
  stopped: 'secondary',
} as const satisfies Record<SessionStatus, string>;

const WHOLE_ROW = contentShape(shapes.rectangle());
const GLYPH_SIZE = 18;

/** One thread row: the harness brand mark (the web sidebar's ghost glyph), title, how long ago it
 * moved, then a status dot and the chevron `NavigationLink` would have drawn.
 *
 * The brand mark is the RN `AgentIcon`, carried into the SwiftUI row through `RNHostView` —
 * `matchContents` so the row takes the mark's Yoga-computed 18pt box, `pointerEvents="none"` so
 * the hosted surface never swallows a tap meant for the row's own gesture. */
export function ThreadRow({ session, now, onPress }: ThreadRowProps): React.ReactNode {
  const palette = useNativePalette();

  return (
    <HStack spacing={10} modifiers={[WHOLE_ROW, onTapGesture(onPress)]}>
      <RNHostView matchContents>
        <View pointerEvents="none" style={{ width: GLYPH_SIZE, height: GLYPH_SIZE }}>
          <AgentIcon kind={session.kind} variant="ghost" size={GLYPH_SIZE} color={palette.text} />
        </View>
      </RNHostView>
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[lineLimit(1)]}>{threadTitle(session)}</Text>
        <Text modifiers={[FOOTNOTE, SECONDARY, lineLimit(1)]}>
          {formatRelativeShort(session.updatedAt, now)}
        </Text>
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
