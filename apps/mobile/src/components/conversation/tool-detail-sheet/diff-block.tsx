import { Column, Row, Spacer, Text, useMaterialColors } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, horizontalScroll, weight } from '@expo/ui/jetpack-compose/modifiers';
import { diffLines, patchLines } from '@linkcode/ui/native';
import {
  DIFF_ADDED_HEX,
  DIFF_REMOVED_HEX,
  gutterLine,
} from '@mobile/components/conversation/tool-detail-sheet/diff-block.shared';

const MONO = { typography: 'bodySmall', fontFamily: 'monospace' } as const;

/** Android unified-diff card for a single path inside the tool-detail sheet. */
export function DiffBlock({
  path,
  oldText,
  newText,
  patch,
}: {
  path: string;
  oldText?: string;
  newText?: string;
  /** Unified-patch text; when it parses to rows it wins over the text pair (same precedence
   * as `diffStats` — codex ships hunk text alongside a patch). */
  patch?: string;
}): React.ReactNode {
  const colors = useMaterialColors();
  const patchRows = patch === undefined ? undefined : patchLines(patch);
  const rows =
    patchRows !== undefined && patchRows.length > 0
      ? patchRows
      : diffLines(oldText ?? '', newText ?? '');
  const additions = rows.filter((row) => row.type === 'add').length;
  const deletions = rows.filter((row) => row.type === 'del').length;

  return (
    <Column verticalArrangement={{ spacedBy: 4 }} modifiers={[fillMaxWidth()]}>
      <Row
        verticalAlignment="center"
        horizontalArrangement={{ spacedBy: 6 }}
        modifiers={[fillMaxWidth()]}
      >
        <Text
          style={MONO}
          color={colors.onSurfaceVariant}
          maxLines={1}
          overflow="ellipsis"
          modifiers={[weight(1)]}
        >
          {path}
        </Text>
        <Spacer />
        {additions > 0 ? (
          <Text style={MONO} color={DIFF_ADDED_HEX}>
            +{additions}
          </Text>
        ) : null}
        {deletions > 0 ? (
          <Text style={MONO} color={DIFF_REMOVED_HEX}>
            −{deletions}
          </Text>
        ) : null}
      </Row>
      <Column modifiers={[horizontalScroll(), fillMaxWidth()]}>
        {rows.map((row) => (
          <Text
            key={row.id}
            style={MONO}
            softWrap={false}
            color={
              row.type === 'add'
                ? DIFF_ADDED_HEX
                : row.type === 'del'
                  ? DIFF_REMOVED_HEX
                  : colors.onSurfaceVariant
            }
          >
            {gutterLine(row)}
          </Text>
        ))}
      </Column>
    </Column>
  );
}
