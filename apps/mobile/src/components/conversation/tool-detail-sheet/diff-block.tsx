import { HStack, ScrollView, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, lineLimit } from '@expo/ui/swift-ui/modifiers';
import { diffLines, patchLines } from '@linkcode/ui/native';
import { SECONDARY } from '@mobile/components/form/styles';

const MONO_FOOTNOTE = font({ textStyle: 'footnote', design: 'monospaced' });
const ADDED = foregroundStyle('#28A745');
const REMOVED = foregroundStyle('#D73A49');

function gutterLine(row: { type: 'add' | 'del' | 'ctx'; text: string }): string {
  const gutter = row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' ';
  return `${gutter} ${row.text || ' '}`;
}

/** Unified-diff card for a single path inside the tool-detail sheet. */
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
  const patchRows = patch === undefined ? undefined : patchLines(patch);
  const rows =
    patchRows !== undefined && patchRows.length > 0
      ? patchRows
      : diffLines(oldText ?? '', newText ?? '');
  const additions = rows.filter((row) => row.type === 'add').length;
  const deletions = rows.filter((row) => row.type === 'del').length;

  return (
    <VStack alignment="leading" spacing={4}>
      <HStack spacing={6}>
        <Text modifiers={[MONO_FOOTNOTE, SECONDARY, lineLimit(1)]}>{path}</Text>
        <Spacer />
        {additions > 0 ? <Text modifiers={[MONO_FOOTNOTE, ADDED]}>+{additions}</Text> : null}
        {deletions > 0 ? <Text modifiers={[MONO_FOOTNOTE, REMOVED]}>−{deletions}</Text> : null}
      </HStack>
      <ScrollView axes="horizontal">
        <VStack alignment="leading" spacing={0}>
          {rows.map((row) => (
            <Text
              key={row.id}
              modifiers={[
                MONO_FOOTNOTE,
                ...(row.type === 'add' ? [ADDED] : row.type === 'del' ? [REMOVED] : [SECONDARY]),
              ]}
            >
              {gutterLine(row)}
            </Text>
          ))}
        </VStack>
      </ScrollView>
    </VStack>
  );
}
