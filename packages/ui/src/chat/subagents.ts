import type { ConversationItem } from './types';

/**
 * Splits subagent transcript items out of a timeline slice. An item belongs to a subagent when it
 * carries a `parentToolCallId` (narration/reasoning) or its tool call does — the id of the
 * `task`-kind tool call that spawned it. Children keep their arrival order per parent; orphans
 * (parent not announced in this slice, e.g. a page-windowed history read) fall back to the
 * top-level timeline so nothing silently disappears.
 */
export interface SubagentPartition {
  topLevel: ConversationItem[];
  childrenByParent: ReadonlyMap<string, ConversationItem[]>;
}

function itemParentId(item: ConversationItem): string | undefined {
  if (item.kind === 'message' || item.kind === 'reasoning') return item.parentToolCallId;
  if (item.kind === 'tool') return item.toolCall.parentToolCallId;
  return undefined;
}

export function partitionSubagentItems(items: readonly ConversationItem[]): SubagentPartition {
  const taskIds = new Set<string>();
  for (const item of items) {
    if (item.kind === 'tool' && item.toolCall.kind === 'task') {
      taskIds.add(item.toolCall.toolCallId);
    }
  }

  const topLevel: ConversationItem[] = [];
  const childrenByParent = new Map<string, ConversationItem[]>();
  for (const item of items) {
    const parent = itemParentId(item);
    if (parent === undefined || !taskIds.has(parent)) {
      topLevel.push(item);
      continue;
    }
    const children = childrenByParent.get(parent);
    if (children) children.push(item);
    else childrenByParent.set(parent, [item]);
  }
  return { topLevel, childrenByParent };
}
