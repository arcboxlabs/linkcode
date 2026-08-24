import { Box, Icon, ListItem, Text } from '@expo/ui/jetpack-compose';
import { background, clickable, clip, Shapes, size } from '@expo/ui/jetpack-compose/modifiers';
import type { AgentKind, SessionStatus } from '@linkcode/schema';
import { AGENT_INITIALS } from '@linkcode/ui/native';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { formatRelativeShort } from '@mobile/utils/relative-time';
import agentClaudeCodeGlyph from '../../../../assets/icons/agent-claude-code.xml';
import agentCodexGlyph from '../../../../assets/icons/agent-codex.xml';
import agentOpencodeGlyph from '../../../../assets/icons/agent-opencode.xml';
import type { ThreadRowProps } from './thread-row.types';
import { threadTitle } from './thread-title';

/** Brand marks vendored as vector drawables from `@proj-airi/lobe-icons` (the web glyph set);
 * kinds without a lobe glyph fall back to initials, matching the web sidebar. */
const AGENT_GLYPHS: Partial<Record<AgentKind, number>> = {
  'claude-code': agentClaudeCodeGlyph,
  codex: agentCodexGlyph,
  opencode: agentOpencodeGlyph,
};

const GLYPH_SIZE = 18;

/** Android thread row: MD3 ListItem with the harness brand mark leading (the web sidebar's ghost
 * glyph), the status dot drawn as a clipped Box, and no disclosure chevron, per MD3. The dot
 * speaks Material roles — MD3 has no success/warning — running reads as the active accent,
 * waiting states as tertiary. */
export function ThreadRow({ session, now, onPress }: ThreadRowProps): React.ReactNode {
  const colors = useAppMaterialColors();
  const statusColor = {
    starting: colors.tertiary,
    idle: colors.outline,
    running: colors.primary,
    'awaiting-input': colors.tertiary,
    stopped: colors.outline,
  } satisfies Record<SessionStatus, string>;
  const glyph = AGENT_GLYPHS[session.kind];

  return (
    <ListItem modifiers={[clickable(onPress)]}>
      <ListItem.LeadingContent>
        {glyph === undefined ? (
          <Box contentAlignment="center" modifiers={[size(GLYPH_SIZE, GLYPH_SIZE)]}>
            <Text style={{ typography: 'labelSmall' }} color={colors.onSurface}>
              {AGENT_INITIALS[session.kind]}
            </Text>
          </Box>
        ) : (
          <Icon source={glyph} size={GLYPH_SIZE} tint={colors.onSurface} />
        )}
      </ListItem.LeadingContent>
      <ListItem.HeadlineContent>
        <Text maxLines={1} overflow="ellipsis">
          {threadTitle(session)}
        </Text>
      </ListItem.HeadlineContent>
      <ListItem.SupportingContent>
        <Text style={{ typography: 'bodySmall' }} color={colors.onSurfaceVariant} maxLines={1}>
          {formatRelativeShort(session.updatedAt, now)}
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
