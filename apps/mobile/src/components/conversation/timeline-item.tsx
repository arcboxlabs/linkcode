import type { ConversationItem } from '@linkcode/client-core';
import type { ContentBlock, ToolCall } from '@linkcode/schema';
import { answerText, NativeMarkdown } from '@linkcode/ui/native';
import { useNativePalette } from '@mobile/components/theme/native-palette';
import { Text, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { ReasoningRow, ToolRow } from './activity-row';
import { TranscriptRecord } from './transcript-record';

function blocksToText(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join('')
    .trim();
}

/** Compact token counts ("193437" → "193.4k") — mirrors the web CompactionMarker's format. */
function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

/** One timeline item: user turns as right-aligned bubbles, agent output full-width markdown,
 * tools and reasoning as compact collapsible rows. Rendered per-row by the screen's list. */
export function TimelineItem({
  item,
  onPressTool,
}: {
  item: ConversationItem;
  /** Opens the tool-detail sheet; tool rows stay inert when absent. */
  onPressTool?: (toolCall: ToolCall) => void;
}): React.ReactNode {
  const t = useTranslations('mobile.conversation');
  const tq = useTranslations('workbench.question');
  const palette = useNativePalette();

  switch (item.kind) {
    case 'message':
      return item.role === 'user' ? (
        <View className="flex-row justify-end">
          <View
            className="max-w-[85%] rounded-2xl px-4 py-2.5"
            style={{ backgroundColor: palette.surface }}
          >
            <Text selectable className="text-body" style={{ color: palette.text }}>
              {blocksToText(item.blocks)}
            </Text>
          </View>
        </View>
      ) : (
        <View className="gap-2.5">
          {item.blocks.map((block, index) =>
            block.type === 'text' ? (
              // eslint-disable-next-line @eslint-react/no-array-index-key -- blocks carry no ids; the array only ever appends while streaming
              <NativeMarkdown key={index} source={block.text} streaming={item.isStreaming} />
            ) : (
              <Text
                // eslint-disable-next-line @eslint-react/no-array-index-key -- see above
                key={index}
                className="italic text-subhead"
                style={{ color: palette.textSecondary }}
              >
                [{block.type}]
              </Text>
            ),
          )}
        </View>
      );
    case 'reasoning':
      return <ReasoningRow text={blocksToText(item.blocks)} streaming={item.isStreaming} />;
    case 'tool':
      return (
        <ToolRow
          title={item.toolCall.title}
          status={item.toolCall.status}
          onPress={onPressTool ? () => onPressTool(item.toolCall) : undefined}
        />
      );
    case 'plan':
      return null;
    case 'approval': {
      // Pending asks are answered from the prompt dock; the timeline records only resolved ones.
      if (!item.resolution) return null;
      const outcome = item.resolution.outcome;
      const optionNames = new Map(item.options.map((option) => [option.optionId, option.name]));
      return (
        <TranscriptRecord
          title={t('approval')}
          entries={[
            {
              id: item.id,
              label: item.title ?? item.toolCall.title ?? '',
              value:
                outcome.outcome === 'selected'
                  ? optionNames.get(outcome.optionId)
                  : tq('dismissed'),
            },
          ]}
        />
      );
    }
    case 'question': {
      if (!item.resolution) return null;
      const outcome = item.resolution.outcome;
      const answers = new Map(
        (outcome.outcome === 'answered' ? outcome.answers : []).map((answer) => [
          answer.questionId,
          answer,
        ]),
      );
      return (
        <TranscriptRecord
          title={outcome.outcome === 'cancelled' ? tq('dismissed') : t('question')}
          entries={item.questions.map((question) => {
            const answer = answers.get(question.questionId);
            return {
              id: question.questionId,
              label: question.prompt,
              value: answer ? (answerText(question, answer) ?? tq('skipped')) : undefined,
            };
          })}
        />
      );
    }
    case 'error':
      return (
        <TranscriptRecord
          title={t('error')}
          error
          entries={[{ id: item.id, label: item.message }]}
        />
      );
    case 'compaction':
      if (item.status === 'in_progress') {
        return (
          <View className="flex-row items-center justify-center gap-2 px-2">
            <Text className="font-semibold text-footnote" style={{ color: palette.textSecondary }}>
              {t('compacting')}
            </Text>
          </View>
        );
      }
      return (
        <View className="flex-row items-center justify-center gap-2 px-2">
          <Text className="font-semibold text-footnote" style={{ color: palette.textSecondary }}>
            {t('compacted')}
          </Text>
          {item.preTokens !== undefined && item.postTokens !== undefined ? (
            <Text className="text-footnote" style={{ color: palette.textSecondary }}>
              {t('compactedTokens', {
                pre: formatTokens(item.preTokens),
                post: formatTokens(item.postTokens),
              })}
            </Text>
          ) : null}
        </View>
      );
    default:
      return null;
  }
}
