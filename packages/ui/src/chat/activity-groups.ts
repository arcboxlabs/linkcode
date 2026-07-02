import type { ToolCall } from '@linkcode/schema';
import type { ConversationItem } from './types';

/**
 * Codex-style transcript grouping. A "run" is a maximal streak of consecutive tool items — any
 * other item kind (assistant text, reasoning, approval, error) is the flush boundary, mirroring
 * Codex's "flush on narration" rule. Within a run, consecutive calls of the same review bucket
 * collapse into a group; approval-gated calls stay standalone because they are interaction
 * points, and lone calls render as plain rows.
 */

export type ActivityBucket = 'explore' | 'command' | 'fetch' | 'think' | 'files' | 'other';

export type ToolTimelineItem = Extract<ConversationItem, { kind: 'tool' }>;

export type ActivityEntry =
  | { type: 'single'; item: ToolTimelineItem }
  | { type: 'group'; id: string; bucket: ActivityBucket; items: ToolTimelineItem[] };

export type TimelineEntry =
  | { type: 'item'; item: ConversationItem }
  | { type: 'activity'; id: string; entries: ActivityEntry[] };

/** Buckets tool kinds by review affordance, so summaries read "Explored" / "Ran commands" / "Edited files". */
export function activityBucket(kind: ToolCall['kind']): ActivityBucket {
  switch (kind) {
    case 'read':
    case 'search':
      return 'explore';
    case 'execute':
      return 'command';
    case 'fetch':
      return 'fetch';
    case 'think':
      return 'think';
    case 'edit':
    case 'delete':
    case 'move':
      return 'files';
    default:
      return 'other';
  }
}

export function groupTimeline(items: readonly ConversationItem[]): TimelineEntry[] {
  // Approval-gated calls are interaction points; never bury them in a group.
  const approvalGated = new Set<string>();
  for (const item of items) {
    if (item.kind === 'approval') approvalGated.add(item.toolCall.toolCallId);
  }

  const entries: TimelineEntry[] = [];
  let run: ToolTimelineItem[] = [];

  const flushRun = (): void => {
    if (run.length === 0) return;
    entries.push({
      type: 'activity',
      id: `run-${run[0].id}`,
      entries: partitionRun(run, approvalGated),
    });
    run = [];
  };

  for (const item of items) {
    if (item.kind === 'tool') {
      run.push(item);
    } else {
      flushRun();
      entries.push({ type: 'item', item });
    }
  }
  flushRun();

  return entries;
}

function partitionRun(
  run: readonly ToolTimelineItem[],
  approvalGated: ReadonlySet<string>,
): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  let streak: ToolTimelineItem[] = [];
  let streakBucket: ActivityBucket | null = null;

  const flushStreak = (): void => {
    if (streak.length === 0) return;
    entries.push(
      streak.length === 1
        ? { type: 'single', item: streak[0] }
        : // Keyed by the first item so the group identity is stable while a streaming burst appends.
          { type: 'group', id: `group-${streak[0].id}`, bucket: streakBucket!, items: streak },
    );
    streak = [];
    streakBucket = null;
  };

  for (const item of run) {
    if (approvalGated.has(item.toolCall.toolCallId)) {
      flushStreak();
      entries.push({ type: 'single', item });
      continue;
    }
    const bucket = activityBucket(item.toolCall.kind);
    if (bucket !== streakBucket) flushStreak();
    streakBucket = bucket;
    streak.push(item);
  }
  flushStreak();

  return entries;
}
