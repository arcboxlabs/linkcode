import { Box, ListItem, Text } from '@expo/ui/jetpack-compose';
import { background, clickable, clip, Shapes, size } from '@expo/ui/jetpack-compose/modifiers';
import type { SessionStatus } from '@linkcode/schema';
import { AGENT_LABELS } from '@linkcode/ui/native';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { formatRelativeShort } from '@mobile/utils/relative-time';
import { useThemeColor } from 'heroui-native';
import type { ThreadRowProps } from './thread-row.types';
import { threadTitle } from './thread-title';

/** Android thread row: MD3 ListItem with the status dot drawn as a clipped Box (no icon asset
 * needed) and no disclosure chevron, per MD3. The dot palette matches the session-title dot. */
export function ThreadRow({ session, now, onPress }: ThreadRowProps): React.ReactNode {
  const colors = useAppMaterialColors();
  const [success, warning, muted] = useThemeColor(['success', 'warning', 'muted']);
  const statusColor = {
    starting: warning,
    idle: muted,
    running: success,
    'awaiting-input': warning,
    stopped: muted,
  } satisfies Record<SessionStatus, string>;
  const subtitle = `${AGENT_LABELS[session.kind]} · ${formatRelativeShort(session.updatedAt, now)}`;

  return (
    <ListItem modifiers={[clickable(onPress)]}>
      <ListItem.HeadlineContent>
        <Text maxLines={1} overflow="ellipsis">
          {threadTitle(session)}
        </Text>
      </ListItem.HeadlineContent>
      <ListItem.SupportingContent>
        <Text style={{ typography: 'bodySmall' }} color={colors.onSurfaceVariant} maxLines={1}>
          {subtitle}
        </Text>
      </ListItem.SupportingContent>
      <ListItem.TrailingContent>
        <Box
          modifiers={[size(8, 8), clip(Shapes.Circle), background(statusColor[session.status])]}
        />
      </ListItem.TrailingContent>
    </ListItem>
  );
}
