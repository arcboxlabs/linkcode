import { useState } from 'react';
import {
  conversationFlowItems,
  declinedToolCallIds,
  selectPendingPromptItems,
} from './conversation-prompts';
import type { TurnSegment, TurnSegmentsSnapshot } from './turn-edits';
import { advanceTurnSegments } from './turn-edits';
import type { ConversationViewModel } from './types';

/**
 * Identity-stable projection the timeline renders from. Settled segments and unchanged sets keep
 * their object identity across events, so a memoized per-turn view re-renders only for the turn
 * that actually changed.
 */
export interface TimelineModel {
  segments: TurnSegment[];
  /** Tool calls declined by an authoritative resolution — render the gated row struck through. */
  declined: ReadonlySet<string>;
  /** Every tool call the agent snapshotted — a declined ask with no snapshot renders its own receipt. */
  snapshottedToolIds: ReadonlySet<string>;
  /** Gated calls whose ask is still open — these carry the shield glyph. */
  awaitingApproval: ReadonlySet<string>;
}

interface TimelineCache {
  conversation: ConversationViewModel;
  segmentsSnapshot: TurnSegmentsSnapshot;
  model: TimelineModel;
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/** The previous set when contents match, so unchanged sets keep identity across events. */
function stableSet(
  prev: ReadonlySet<string> | undefined,
  next: ReadonlySet<string>,
): ReadonlySet<string> {
  return prev && setsEqual(prev, next) ? prev : next;
}

function advanceTimeline(
  prev: TimelineCache | null,
  conversation: ConversationViewModel,
): TimelineCache {
  const { items } = conversation;
  // Plan items live in the dock, not the stream; filtered items keep identity, so the
  // incremental prefix walk still sees settled turns as unchanged.
  const flowItems = conversationFlowItems(items);
  const segments = advanceTurnSegments(prev?.segmentsSnapshot ?? null, flowItems);

  const snapshotted = new Set<string>();
  for (const item of items) {
    if (item.kind === 'tool') snapshotted.add(item.toolCall.toolCallId);
  }
  const awaiting = new Set<string>();
  for (const item of selectPendingPromptItems(conversation)) {
    if (item.kind === 'approval') awaiting.add(item.toolCall.toolCallId);
  }

  const model: TimelineModel = {
    segments,
    declined: stableSet(prev?.model.declined, declinedToolCallIds(items)),
    snapshottedToolIds: stableSet(prev?.model.snapshottedToolIds, snapshotted),
    awaitingApproval: stableSet(prev?.model.awaitingApproval, awaiting),
  };
  return { conversation, segmentsSnapshot: { items: flowItems, segments }, model };
}

/**
 * Fold the conversation into a {@link TimelineModel}, advancing incrementally from the previous
 * render — the render-phase "storing information from previous renders" pattern, so the fold is
 * O(changed tail) instead of O(timeline) per event.
 */
export function useTimelineModel(conversation: ConversationViewModel): TimelineModel {
  const [cache, setCache] = useState<TimelineCache | null>(null);
  if (cache?.conversation !== conversation) {
    const next = advanceTimeline(cache, conversation);
    setCache(next);
    return next.model;
  }
  return cache.model;
}
