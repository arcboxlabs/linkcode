import type { ActivityRunItem } from './activity-groups';
import { publicReasoningSummary } from './reasoning-summary';

export type ActivitySummaryCategory =
  | 'failure'
  | 'integration'
  | 'command'
  | 'files'
  | 'explore'
  | 'thinking';

type ActivityCategory = Exclude<ActivitySummaryCategory, 'failure'>;
type CountedActivityCategory = Exclude<ActivityCategory, 'thinking'>;
type ActivityToolKind = Extract<ActivityRunItem, { kind: 'tool' }>['toolCall']['kind'];
type ReasoningActivityItem = Extract<ActivityRunItem, { kind: 'reasoning' }>;

export type ActivityCurrentDescriptor =
  | { category: 'thinking'; kind: 'reasoning'; summary?: string }
  | { category: 'thinking'; kind: 'think' }
  | { category: 'files'; kind: 'edit' | 'delete' | 'move' }
  | { category: 'integration'; kind: 'other' }
  | { category: 'command'; kind: 'execute' }
  | { category: 'explore'; kind: 'read' | 'search' | 'fetch' };

export type ActivityCurrentKind = ActivityCurrentDescriptor['kind'];

export type ActivitySummaryClause =
  | { category: 'failure' | CountedActivityCategory; count: number }
  | { category: 'thinking' };

export interface SettledActivityRunDescriptor {
  clauses: ActivitySummaryClause[];
}

const SETTLED_CATEGORY_PRIORITY = [
  'integration',
  'command',
  'files',
  'explore',
] as const satisfies readonly CountedActivityCategory[];

/** Describes the most recent active item without reading its content or tool payload. */
export function activityRunCurrentDescriptor(
  items: readonly ActivityRunItem[],
): ActivityCurrentDescriptor | undefined {
  // Thinking is the user's best signal that the agent is actively deciding what to do. Prefer
  // the newest streaming reasoning / think call before falling back to another active tool.
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === 'reasoning' && item.isStreaming) return reasoningDescriptor(item);
    if (item.kind === 'tool' && item.toolCall.kind === 'think' && isActiveTool(item)) {
      return toolDescriptor(item.toolCall.kind);
    }
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === 'tool' && isActiveTool(item)) return toolDescriptor(item.toolCall.kind);
  }

  return undefined;
}

/** Fixed-priority counted clauses. Thinking is noise in a mixed run and only survives as the
 * generic fallback for an otherwise empty, successful summary. */
export function settledActivityRunDescriptor(
  items: readonly ActivityRunItem[],
): SettledActivityRunDescriptor {
  const categoryCounts = new Map<CountedActivityCategory, number>();
  let failureCount = 0;
  let hasThinking = false;

  for (const item of items) {
    if (item.kind === 'tool' && item.toolCall.status === 'failed') failureCount += 1;
    const category = activityCategory(item);
    if (category === 'thinking') {
      hasThinking = true;
      continue;
    }
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }

  const clauses: ActivitySummaryClause[] = [];
  if (failureCount > 0) clauses.push({ category: 'failure', count: failureCount });
  for (const category of SETTLED_CATEGORY_PRIORITY) {
    const count = categoryCounts.get(category);
    if (count !== undefined) clauses.push({ category, count });
  }
  if (clauses.length === 0 && hasThinking) clauses.push({ category: 'thinking' });

  return {
    clauses,
  };
}

function activityCategory(item: ActivityRunItem): ActivityCategory {
  return item.kind === 'reasoning' ? 'thinking' : toolDescriptor(item.toolCall.kind).category;
}

type ToolActivityDescriptor = Exclude<ActivityCurrentDescriptor, { kind: 'reasoning' }>;
type ReasoningActivityDescriptor = Extract<ActivityCurrentDescriptor, { kind: 'reasoning' }>;

function toolDescriptor(kind: ActivityToolKind): ToolActivityDescriptor {
  switch (kind) {
    case 'edit':
    case 'delete':
    case 'move':
      return { category: 'files', kind };
    case 'other':
      return { category: 'integration', kind };
    case 'execute':
      return { category: 'command', kind };
    case 'read':
    case 'search':
    case 'fetch':
      return { category: 'explore', kind };
    case 'think':
      return { category: 'thinking', kind };
    default:
      return kind satisfies never;
  }
}

function isActiveTool(item: Extract<ActivityRunItem, { kind: 'tool' }>): boolean {
  return item.toolCall.status === 'pending' || item.toolCall.status === 'in_progress';
}

function reasoningDescriptor(item: ReasoningActivityItem): ReasoningActivityDescriptor {
  const summary = explicitPublicSummary(item);
  return summary
    ? { category: 'thinking', kind: 'reasoning', summary }
    : { category: 'thinking', kind: 'reasoning' };
}

function explicitPublicSummary(item: ReasoningActivityItem): string | undefined {
  if (!('summary' in item) || typeof item.summary !== 'string') return undefined;
  return publicReasoningSummary(item.summary);
}
