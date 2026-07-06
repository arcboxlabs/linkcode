import { diffStats } from './diff-utils';
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

/**
 * Roll up the files a turn's tool calls edited, in first-touched order. Only completed calls
 * count — a failed or declined edit never landed. Null when the turn edited nothing.
 */
export function turnFileEdits(items: readonly ConversationItem[]): TurnEdits | null {
  const byPath = new Map<string, TurnFileEdit>();
  for (const item of items) {
    if (item.kind !== 'tool' || item.toolCall.status !== 'completed') continue;
    for (const content of item.toolCall.content) {
      if (content.type !== 'diff') continue;
      const stats = diffStats(content.oldText, content.newText);
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
