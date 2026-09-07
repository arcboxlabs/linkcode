import type { ConversationItem } from '@linkcode/client-core';
import type { ContentBlock, ToolCall } from '@linkcode/schema';
import { NativeMarkdown } from '@linkcode/ui/native';
import { useNativePalette } from '@mobile/components/theme/native-palette';
import { Text, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { ReasoningRow, ToolRow } from './activity-row';

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
  const palette = useNativePalette();

  switch (item.kind) {
    case 'message':
      return item.role === 'user' ? (
        <View className="flex-row justify-end">
          <View
            className="max-w-[85%] rounded-2xl px-4 py-2.5"
            style={{ backgroundColor: palette.surface }}
          >
            <Text className="text-body" style={{ color: palette.text }}>
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
    case 'approval':
      // Pending asks are answered from the prompt dock; the timeline records only resolved ones.
      if (!item.resolution) return null;
      return (
        <View className="gap-1 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5">
          <Text className="font-semibold text-caption text-warning">{t('approval')}</Text>
          <Text className="text-foreground text-subhead">{item.toolCall.title ?? ''}</Text>
        </View>
      );
    case 'question':
      if (!item.resolution) return null;
      return (
        <View className="gap-1 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2.5">
          <Text className="font-semibold text-accent text-caption">{t('question')}</Text>
          {item.questions.map((question) => (
            <Text key={question.questionId} className="text-foreground text-subhead">
              {question.prompt}
            </Text>
          ))}
        </View>
      );
    case 'error':
      return (
        <View className="gap-1 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2.5">
          <Text className="font-semibold text-caption text-danger">{t('error')}</Text>
          <Text className="text-foreground text-subhead">{item.message}</Text>
        </View>
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
