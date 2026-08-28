import { appendArrayInPlace } from 'foxts/append-array-in-place';
import { activityItemBrand } from './activity-summary';
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
  /** Equal non-null keys form a run until another key or a non-activity item interrupts it;
   * `ACTIVITY_RUN_GLUE_KEY` joins the surrounding run without setting its key. */
  classify(item: ConversationItem, context: ActivityGroupingContext): string | null;
  minimumGroupSize: number;
}

const DEFAULT_ACTIVITY_KEY = 'activity';

/** Classification that extends whatever run surrounds the item instead of keying its own. */
export const ACTIVITY_RUN_GLUE_KEY = '*';

export const defaultActivityGroupingPolicy: ActivityGroupingPolicy = {
  // Branded integration calls run in their own dedicated groups, so a failing generic call never
  // shares a header (or paints its glyph) with a healthy integration. Thinking is glue — agents
  // routinely reason between calls, and a key of its own would split every brand run apart.
  classify(item) {
    if (!isActivityRunItem(item)) return null;
    if (item.kind === 'reasoning' || item.toolCall.kind === 'think') return ACTIVITY_RUN_GLUE_KEY;
    const brand = activityItemBrand(item);
    return brand === undefined ? DEFAULT_ACTIVITY_KEY : `brand:${brand}`;
  },
  minimumGroupSize: 2,
};

export function groupTimeline(
  items: readonly ConversationItem[],
  policy: ActivityGroupingPolicy = defaultActivityGroupingPolicy,
): TimelineEntry[] {
  // Policies may preserve approval-gated tools as standalone interaction points.
  const approvalGated = new Set<string>();
  for (let i = 0, len = items.length; i < len; i++) {
    const item = items[i];
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

  for (let i = 0, len = items.length; i < len; i++) {
    const index = i,
      item = items[i];
    const key = policy.classify(item, {
      index,
      timeline: items,
      approvalGatedToolCallIds: approvalGated,
    });
    if (key === null || !isActivityRunItem(item)) {
      flushRun();
      entries.push({ type: 'item', item });
      continue;
    }
    if (key !== ACTIVITY_RUN_GLUE_KEY) {
      if (runKey !== null && key !== runKey) flushRun();
      runKey = key;
    }
    run.push(item);
  }
  flushRun();

  return entries;
}

function isActivityRunItem(item: ConversationItem): item is ActivityRunItem {
  return item.kind === 'reasoning' || (item.kind === 'tool' && item.toolCall.kind !== 'task');
}
