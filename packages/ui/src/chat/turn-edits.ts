import { diffContentStats } from './diff-utils';
import type { ConversationItem, ConversationTurnId } from './types';

export interface TurnSegment<T extends ConversationItem = ConversationItem> {
  turnId: ConversationTurnId;
  items: T[];
}

/** Split the timeline into turn segments — consecutive runs of one turnId (user messages open turns). */
export function splitTurnSegments<T extends ConversationItem>(
  items: readonly T[],
): Array<TurnSegment<T>> {
  const segments: Array<TurnSegment<T>> = [];
  for (const item of items) {
    const current = segments.at(-1);
    // turnId is string | null, never undefined, so a match proves `current` exists.
    if (current?.turnId === item.turnId) current.items.push(item);
    else segments.push({ turnId: item.turnId, items: [item] });
  }
  return segments;
}

export interface TurnSegmentsSnapshot<T extends ConversationItem = ConversationItem> {
  items: readonly T[];
  segments: Array<TurnSegment<T>>;
}

/**
 * Re-derive segments incrementally: the conversation builder replaces only changed items (the
 * live tail), so every segment fully inside the shared item prefix is reused by reference —
 * settled turns keep segment identity across events and memoized per-turn views skip them.
 */
export function advanceTurnSegments<T extends ConversationItem>(
  prev: TurnSegmentsSnapshot<T> | null,
  items: readonly T[],
): Array<TurnSegment<T>> {
  if (!prev) return splitTurnSegments(items);
  if (prev.items === items) return prev.segments;

  const shared = Math.min(prev.items.length, items.length);
  let stable = 0;
  while (stable < shared && prev.items[stable] === items[stable]) stable += 1;

  const reused: Array<TurnSegment<T>> = [];
  let covered = 0;
  for (const segment of prev.segments) {
    if (covered + segment.items.length > stable) break;
    reused.push(segment);
    covered += segment.items.length;
  }
  // The run at the cut may continue into the rebuilt suffix (same turnId); rebuild that segment
  // from its start so the run stays one segment. Consecutive segments never share a turnId, so
  // one step back suffices.
  const boundary = reused.at(-1);
  if (boundary && covered < items.length && items[covered].turnId === boundary.turnId) {
    reused.pop();
    covered -= boundary.items.length;
  }
  if (covered === items.length && reused.length === prev.segments.length) return prev.segments;
  return [...reused, ...splitTurnSegments(items.slice(covered))];
}

export interface TurnFileEdit {
  path: string;
  additions: number;
  deletions: number;
}

export interface TurnEdits {
  files: TurnFileEdit[];
  additions: number;
  deletions: number;
}

/** Files a turn's tool calls edited, first-touched order; only completed calls count (a failed
 * or declined edit never landed). Null when the turn edited nothing. */
export function turnFileEdits(items: readonly ConversationItem[]): TurnEdits | null {
  const byPath = new Map<string, TurnFileEdit>();
  for (const item of items) {
    if (item.kind !== 'tool' || item.toolCall.status !== 'completed') continue;
    for (const content of item.toolCall.content) {
      if (content.type !== 'diff') continue;
      const stats = diffContentStats(content);
      const edit = byPath.get(content.path) ?? { path: content.path, additions: 0, deletions: 0 };
      edit.additions += stats.additions;
      edit.deletions += stats.deletions;
      byPath.set(content.path, edit);
    }
  }
  if (byPath.size === 0) return null;
  const files = [...byPath.values()];
  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}
