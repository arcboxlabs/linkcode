import type { ToolCall } from '@linkcode/schema';
import { ChevronDown } from 'lucide-react-native';
import { memo, useMemo, useRef, useState } from 'react';
import type {
  FlatList as FlatListType,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import { FlatList, Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useCSSVariable } from 'uniwind';
import { useTranslations } from 'use-intl';

import { AssistantMessage } from './assistant-message';
import { CompactionRow } from './compaction-row';
import { ErrorRow } from './error-row';
import { ReasoningRow } from './reasoning-row';
import { ToolRow } from './tool-row';
import type { ChatTimelineItem } from './types';
import { UserMessage } from './user-message';

export interface ConversationListProps {
  items: ChatTimelineItem[];
  /** Opens the tool-detail sheet for a call with a body. */
  onPressTool: (toolCall: ToolCall) => void;
  /** Long-press copy on message text; the app owns clipboard + haptics. */
  onCopyText?: (text: string) => void;
  /**
   * Permission asks the user declined in this client. Desktop parity: a declined ask whose
   * tool call never got snapshotted renders as a danger tool row; everything resolved else
   * leaves no trace.
   */
  declinedRequestIds?: readonly string[];
}

interface RowSpec {
  item: ChatTimelineItem;
  /** Consecutive-tool-run spacing (Paseo `toolSequence`). */
  inSequence: boolean;
  /** Subagent narration indents under its spawning task call. */
  indented: boolean;
}

const SCROLL_FAB_THRESHOLD = 600;

const TimelineRow = memo(function TimelineRow({
  spec,
  onPressTool,
  onCopyText,
}: {
  spec: RowSpec;
  onPressTool: (toolCall: ToolCall) => void;
  onCopyText?: (text: string) => void;
}): React.ReactNode {
  const { item, inSequence, indented } = spec;

  const content = (() => {
    switch (item.kind) {
      case 'message':
        return item.role === 'user' ? (
          <UserMessage blocks={item.blocks} onCopyText={onCopyText} />
        ) : (
          <AssistantMessage
            blocks={item.blocks}
            isStreaming={item.isStreaming}
            onCopyText={onCopyText}
          />
        );
      case 'reasoning':
        return <ReasoningRow blocks={item.blocks} isStreaming={item.isStreaming} />;
      case 'tool':
        return <ToolRow toolCall={item.toolCall} onPress={onPressTool} inSequence={inSequence} />;
      case 'compaction':
        return <CompactionRow preTokens={item.preTokens} postTokens={item.postTokens} />;
      case 'error':
        return <ErrorRow message={item.message} code={item.code} recoverable={item.recoverable} />;
      // Plans surface in the dock's plan tracker; resolved approvals/questions leave no trace
      // (declined-and-unsnapshotted asks are materialized as failed tool rows upstream).
      case 'plan':
      case 'approval':
      case 'question':
        return null;
      default:
        return item satisfies never;
    }
  })();

  if (content === null) return null;
  return (
    <View
      className={`px-4 ${inSequence ? 'pt-0' : 'pt-2.5'} ${indented ? 'border-border border-l-2 pl-6' : ''}`}
    >
      {content}
    </View>
  );
});

/**
 * The timeline: an inverted FlatList anchored at the live edge (Paseo's native strategy),
 * newest item at index 0, with a scroll-to-bottom fab once the user scrolls away.
 */
export function ConversationList({
  items,
  onPressTool,
  onCopyText,
  declinedRequestIds,
}: ConversationListProps): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const listRef = useRef<FlatListType<RowSpec>>(null);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [borderColor, mutedColor, backgroundColor] = useCSSVariable([
    '--border',
    '--muted',
    '--background',
  ]);

  const rows = useMemo((): RowSpec[] => {
    const toolItemIds = new Set(
      items.flatMap((item) => (item.kind === 'tool' ? [item.toolCall.toolCallId] : [])),
    );
    const declined = new Set(declinedRequestIds);

    const specs: RowSpec[] = [];
    for (const item of items) {
      let materialized: ChatTimelineItem = item;
      if (item.kind === 'approval') {
        // Desktop parity: only a declined ask whose call never snapshotted renders (as a
        // failed tool row); accepted / pending asks leave no receipt in the timeline.
        const toolCallId = item.toolCall.toolCallId;
        if (!declined.has(item.requestId) || toolItemIds.has(toolCallId)) continue;
        materialized = {
          kind: 'tool',
          id: item.id,
          turnId: item.turnId,
          toolCall: {
            toolCallId,
            title: item.toolCall.title ?? '',
            kind: item.toolCall.kind ?? 'other',
            status: 'failed',
            content: item.toolCall.content ?? [],
            rawInput: item.toolCall.rawInput,
            rawOutput: item.toolCall.rawOutput,
          },
        };
      } else if (item.kind === 'plan' || item.kind === 'question') {
        continue;
      }

      const previous = specs.at(-1);
      specs.push({
        item: materialized,
        inSequence: materialized.kind === 'tool' && previous?.item.kind === 'tool',
        indented:
          (materialized.kind === 'message' || materialized.kind === 'reasoning') &&
          materialized.parentToolCallId !== undefined,
      });
    }
    specs.reverse();
    return specs;
  }, [items, declinedRequestIds]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const away = event.nativeEvent.contentOffset.y > SCROLL_FAB_THRESHOLD;
    setAwayFromBottom((current) => (current === away ? current : away));
  };

  return (
    <View className="flex-1">
      <FlatList
        ref={listRef}
        data={rows}
        renderItem={({ item: spec }) => (
          <TimelineRow spec={spec} onPressTool={onPressTool} onCopyText={onCopyText} />
        )}
        keyExtractor={(spec) => spec.item.id}
        inverted
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        initialNumToRender={30}
        windowSize={21}
        removeClippedSubviews={false}
        onScroll={onScroll}
        scrollEventThrottle={64}
        contentContainerStyle={{ paddingVertical: 10 }}
      />
      {awayFromBottom ? (
        <Animated.View
          entering={FadeIn.duration(150)}
          exiting={FadeOut.duration(150)}
          className="absolute right-4 bottom-3"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('scrollToBottom')}
            onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
            className="size-11 items-center justify-center rounded-full border"
            style={{
              borderColor: String(borderColor),
              backgroundColor: String(backgroundColor),
            }}
          >
            <ChevronDown size={18} color={String(mutedColor)} />
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}
