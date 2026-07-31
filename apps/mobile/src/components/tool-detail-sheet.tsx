import {
  BottomSheet,
  Group,
  Host,
  HStack,
  Image,
  ScrollView,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  font,
  foregroundStyle,
  lineLimit,
  padding,
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import type { ToolCall, ToolKind } from '@linkcode/schema';
import {
  diffLines,
  patchLines,
  stripAnsi,
  toolCallCommand,
  toolCallDisplayContent,
  toolCallFailureMessage,
  toolCallMetadata,
} from '@linkcode/ui/native';
import { useTranslations } from 'use-intl';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const MONO_FOOTNOTE = font({ textStyle: 'footnote', design: 'monospaced' });
const ADDED = foregroundStyle('#28A745');
const REMOVED = foregroundStyle('#D73A49');

/** SF Symbol per tool kind — the SwiftUI mirror of the timeline's lucide set. */
const KIND_SYMBOL: Record<ToolKind, React.ComponentProps<typeof Image>['systemName']> = {
  read: 'doc.text',
  edit: 'square.and.pencil',
  delete: 'trash',
  move: 'arrow.turn.down.right',
  search: 'magnifyingglass',
  execute: 'terminal',
  think: 'brain',
  fetch: 'globe',
  task: 'cpu',
  other: 'wrench.and.screwdriver',
};

function gutterLine(row: { type: 'add' | 'del' | 'ctx'; text: string }): string {
  const gutter = row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' ';
  return `${gutter} ${row.text || ' '}`;
}

function DiffBlock({
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

/**
 * Tool-call body host (design §4.3): tapping a tool row opens this sheet instead of expanding
 * inline, keeping the inverted list's layout stable. Content mirrors desktop's expanded
 * `ToolCallBody`: metadata badges, diff cards, output, failure message.
 */
export function ToolDetailSheet({
  toolCall,
  onDismiss,
}: {
  /** The call whose body to show; null keeps the sheet dismissed. */
  toolCall: ToolCall | null;
  onDismiss: () => void;
}): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const metadata = toolCall ? toolCallMetadata(toolCall) : [];
  const contents = toolCall ? toolCallDisplayContent(toolCall) : [];
  const failure = toolCall ? toolCallFailureMessage(toolCall) : undefined;
  const command = toolCall?.kind === 'execute' ? toolCallCommand(toolCall) : undefined;
  const rawOutput =
    toolCall && contents.length === 0 && typeof toolCall.rawOutput === 'string'
      ? stripAnsi(toolCall.rawOutput)
      : undefined;

  return (
    // The sheet presents its own window, but the anchor itself must live in a SwiftUI Host.
    <Host matchContents>
      <BottomSheet
        isPresented={toolCall !== null}
        onIsPresentedChange={(presented) => {
          if (!presented) onDismiss();
        }}
      >
        <Group
          modifiers={[
            presentationDetents(['medium', 'large']),
            presentationDragIndicator('visible'),
          ]}
        >
          {toolCall ? (
            <ScrollView modifiers={[padding({ all: 16 })]}>
              <VStack alignment="leading" spacing={12}>
                <HStack spacing={8}>
                  <Image
                    systemName={KIND_SYMBOL[toolCall.kind]}
                    size={15}
                    modifiers={
                      toolCall.status === 'failed' ? [foregroundStyle('#D73A49')] : [SECONDARY]
                    }
                  />
                  <Text
                    modifiers={[
                      font({ textStyle: 'subheadline', weight: 'semibold' }),
                      lineLimit(1),
                    ]}
                  >
                    {toolCall.title}
                  </Text>
                  <Spacer />
                </HStack>
                {metadata.length > 0 ? (
                  <VStack alignment="leading" spacing={2}>
                    {metadata.map((entry) => (
                      <Text
                        key={`${entry.key}:${entry.label ?? ''}:${entry.value}`}
                        modifiers={[MONO_FOOTNOTE, SECONDARY, lineLimit(2)]}
                      >
                        {[entry.label ?? entry.key, entry.value].join(' ')}
                      </Text>
                    ))}
                  </VStack>
                ) : null}
                {contents.map((content, index) => {
                  if (content.type === 'diff') {
                    return (
                      <DiffBlock
                        // eslint-disable-next-line @eslint-react/no-array-index-key -- tool content carries no id; snapshots replace wholesale
                        key={index}
                        path={content.path}
                        oldText={content.oldText}
                        newText={content.newText}
                        patch={content.patch?.text}
                      />
                    );
                  }
                  if (content.type === 'content' && content.content.type === 'text') {
                    return (
                      <Text
                        // eslint-disable-next-line @eslint-react/no-array-index-key -- tool content carries no id; snapshots replace wholesale
                        key={index}
                        modifiers={[font({ textStyle: 'footnote' })]}
                      >
                        {content.content.text}
                      </Text>
                    );
                  }
                  return null;
                })}
                {command || rawOutput ? (
                  <VStack alignment="leading" spacing={4}>
                    {command ? (
                      <Text modifiers={[MONO_FOOTNOTE, SECONDARY, lineLimit(2)]}>{command}</Text>
                    ) : null}
                    {rawOutput ? (
                      <ScrollView axes="horizontal">
                        <Text modifiers={[MONO_FOOTNOTE]}>{rawOutput}</Text>
                      </ScrollView>
                    ) : null}
                  </VStack>
                ) : null}
                {failure ? (
                  <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('#D73A49')]}>
                    {t('failed')}: {failure}
                  </Text>
                ) : null}
              </VStack>
            </ScrollView>
          ) : (
            <Text> </Text>
          )}
        </Group>
      </BottomSheet>
    </Host>
  );
}
