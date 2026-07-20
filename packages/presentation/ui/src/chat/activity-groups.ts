import { appendArrayInPlace } from 'foxts/append-array-in-place';
import type { ConversationItem } from './types';

type ReasoningTimelineItem = Extract<ConversationItem, { kind: 'reasoning' }>;
export type ToolTimelineItem = Extract<ConversationItem, { kind: 'tool' }>;
type NonTaskToolTimelineItem = ToolTimelineItem & {
  toolCall: ToolTimelineItem['toolCall'] & {
    kind: Exclude<ToolTimelineItem['toolCall']['kind'], 'task'>;
  };
};

/** Activity which can be collapsed without hiding narration or an interactive subagent. */
export type ActivityRunItem = ReasoningTimelineItem | NonTaskToolTimelineItem;

export type TimelineEntry =
  | { type: 'item'; item: ConversationItem }
  | { type: 'run'; id: string; items: ActivityRunItem[] };

export interface ActivityGroupingContext {
  readonly index: number;
  readonly timeline: readonly ConversationItem[];
  readonly approvalGatedToolCallIds: ReadonlySet<string>;
}

export interface ActivityGroupingPolicy {
  /** Equal non-null keys form a run until another key or a non-activity item interrupts it. */
  classify(item: ConversationItem, context: ActivityGroupingContext): string | null;
  minimumGroupSize: number;
}

const DEFAULT_ACTIVITY_KEY = 'activity';

export const defaultActivityGroupingPolicy: ActivityGroupingPolicy = {
  classify: (item) => (isActivityRunItem(item) ? DEFAULT_ACTIVITY_KEY : null),
  minimumGroupSize: 2,
};

export function groupTimeline(
  items: readonly ConversationItem[],
  policy: ActivityGroupingPolicy = defaultActivityGroupingPolicy,
): TimelineEntry[] {
  // Policies may preserve approval-gated tools as standalone interaction points.
  const approvalGated = new Set<string>();
  for (const item of items) {
    if (item.kind === 'approval') approvalGated.add(item.toolCall.toolCallId);
  }

  const entries: TimelineEntry[] = [];
  let run: ActivityRunItem[] = [];
  let runKey: string | null = null;

  const flushRun = (): void => {
    if (run.length === 0) return;
    if (run.length >= policy.minimumGroupSize) {
      entries.push({ type: 'run', id: `run-${run[0].id}`, items: run });
    } else {
      appendArrayInPlace(
        entries,
        run.map((item) => ({ type: 'item' as const, item })),
      );
    }
    run = [];
    runKey = null;
  };

  for (const [index, item] of items.entries()) {
    const key = policy.classify(item, {
      index,
      timeline: items,
      approvalGatedToolCallIds: approvalGated,
    });
    if (!isActivityRunItem(item) || key === null) {
      flushRun();
      entries.push({ type: 'item', item });
      continue;
    }
    if (runKey !== null && key !== runKey) flushRun();
    runKey = key;
    run.push(item);
  }
  flushRun();

  return entries;
}

function isActivityRunItem(item: ConversationItem): item is ActivityRunItem {
  return item.kind === 'reasoning' || (item.kind === 'tool' && item.toolCall.kind !== 'task');
}
