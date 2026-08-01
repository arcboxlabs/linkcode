import type { ConversationItem } from '@linkcode/client-core';
import type { ContentBlock, ToolCall } from '@linkcode/schema';
import { NativeMarkdown } from '@linkcode/ui/native';
import { Spinner, useThemeColor } from 'heroui-native';
import { ChevronDownIcon, ChevronRightIcon, CircleAlertIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslations } from 'use-intl';

function blocksToText(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join('')
    .trim();
}

const PLAN_STATUS_MARK = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
  cancelled: '×',
} as const;

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

  switch (item.kind) {
    case 'message':
      return item.role === 'user' ? (
        <View className="flex-row justify-end">
          <View className="max-w-[85%] rounded-2xl bg-surface-secondary px-4 py-2.5">
            <Text className="text-body text-foreground">{blocksToText(item.blocks)}</Text>
          </View>
        </View>
      ) : (
        <View className="gap-2.5">
          {item.blocks.map((block, index) =>
            block.type === 'text' ? (
              // eslint-disable-next-line @eslint-react/no-array-index-key -- blocks carry no ids; the array only ever appends while streaming
              <NativeMarkdown key={index} source={block.text} streaming={item.isStreaming} />
            ) : (
              // eslint-disable-next-line @eslint-react/no-array-index-key -- see above
              <Text key={index} className="italic text-muted text-subhead">
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
      return (
        <View className="gap-1.5 rounded-lg bg-surface-secondary px-3 py-2.5">
          <Text className="font-semibold text-caption text-muted uppercase">{t('plan')}</Text>
          {item.plan.entries.map((entry, index) => (
            <Text
              // eslint-disable-next-line @eslint-react/no-array-index-key -- plan entries carry no id; index is stable because plans are replaced wholesale
              key={index}
              className={
                entry.status === 'completed' || entry.status === 'cancelled'
                  ? 'text-muted text-subhead'
                  : 'text-foreground text-subhead'
              }
            >
              {PLAN_STATUS_MARK[entry.status]} {entry.content}
            </Text>
          ))}
        </View>
      );
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
            <Text className="font-semibold text-footnote text-muted">{t('compacting')}</Text>
          </View>
        );
      }
      return (
        <View className="flex-row items-center justify-center gap-2 px-2">
          <Text className="font-semibold text-footnote text-muted">{t('compacted')}</Text>
          {item.preTokens !== undefined && item.postTokens !== undefined ? (
            <Text className="text-footnote text-muted">
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

function ReasoningRow({ text, streaming }: { text: string; streaming: boolean }): React.ReactNode {
  const t = useTranslations('mobile.conversation');
  const muted = useThemeColor('muted');
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;

  return (
    <View className="gap-1">
      <Pressable
        accessibilityRole="button"
        className="flex-row items-center gap-1.5"
        onPress={() => setOpen((current) => !current)}
      >
        <Text className="text-muted text-subhead">{t('reasoning')}</Text>
        {streaming ? <Spinner size="sm" /> : <Chevron size={14} color={muted} />}
      </Pressable>
      {open ? <Text className="text-muted text-subhead">{text}</Text> : null}
    </View>
  );
}

/** A quiet, collapsed summary line — the chevron sits against the label rather than at the
 *  row's trailing edge, so the row reads as one phrase. A failed call is common and often
 *  expected here, so it stays in the muted voice and is marked by an icon rather than by
 *  colouring the whole line; the icon is also what keeps the status off colour alone. */
function ToolRow({
  title,
  status,
  onPress,
}: {
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  onPress?: () => void;
}): React.ReactNode {
  const [muted, danger] = useThemeColor(['muted', 'danger']);

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      className="flex-row items-center gap-1"
    >
      <Text className="shrink text-muted text-subhead" numberOfLines={1}>
        {title}
      </Text>
      {status === 'failed' ? <CircleAlertIcon size={13} color={danger} /> : null}
      {status === 'in_progress' ? (
        <Spinner size="sm" />
      ) : (
        <ChevronRightIcon size={14} color={muted} />
      )}
    </Pressable>
  );
}
