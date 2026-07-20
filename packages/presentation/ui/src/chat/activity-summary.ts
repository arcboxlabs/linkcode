import type { ActivityRunItem } from './activity-groups';
import { contentPreview } from './content-preview';
import { toolCallFilePresentation } from './file-tool-presentation';
import { toolCallFetchUrl, toolCallSearchQuery } from './tool-result-content';
import { mcpToolName, toolCallCommand, toolCallDisplayTitle } from './tool-utils';

export type ActivitySummaryCategory =
  | 'failure'
  | 'files'
  | 'integration'
  | 'command'
  | 'explore'
  | 'thinking';

type ActivityCategory = Exclude<ActivitySummaryCategory, 'failure'>;
type ActivityToolKind = Extract<ActivityRunItem, { kind: 'tool' }>['toolCall']['kind'];

export interface ActivityItemDescriptor {
  category: ActivityCategory;
  detail?: string;
}

export type ActivityCurrentKind = 'reasoning' | ActivityToolKind;

export interface ActivityCurrentDescriptor extends ActivityItemDescriptor {
  kind: ActivityCurrentKind;
}

export type ActivitySummaryClause = ActivityItemDescriptor | { category: 'failure' };

export interface SettledActivityRunDescriptor {
  clauses: ActivitySummaryClause[];
}

const DETAIL_MAX_LENGTH = 160;
const RE_WHITESPACE = /\s+/gu;
const SENSITIVE_DETAIL_PATTERN =
  /authorization|bearer|api[-_\s]?key|token|password|secret|credential|private[-_\s]?key/iu;

/** Describes the most recent active item without exposing its content or tool payload. */
export function activityRunCurrentDescriptor(
  items: readonly ActivityRunItem[],
): ActivityCurrentDescriptor | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (
      (item.kind === 'reasoning' && item.isStreaming) ||
      (item.kind === 'tool' &&
        (item.toolCall.status === 'pending' || item.toolCall.status === 'in_progress'))
    ) {
      return {
        ...describeActivityItem(item),
        kind: item.kind === 'reasoning' ? 'reasoning' : item.toolCall.kind,
      };
    }
  }
  return undefined;
}

/** One bounded clause per semantic category; failures lead and the rest keep first-seen order. */
export function settledActivityRunDescriptor(
  items: readonly ActivityRunItem[],
): SettledActivityRunDescriptor {
  const clauses = new Map<
    ActivityCategory,
    { descriptor: ActivityItemDescriptor; repeated: boolean }
  >();
  let failed = false;

  for (const item of items) {
    if (item.kind === 'tool' && item.toolCall.status === 'failed') failed = true;

    const descriptor = describeActivityItem(item);
    const clause = clauses.get(descriptor.category);
    if (!clause) {
      clauses.set(descriptor.category, { descriptor, repeated: false });
      continue;
    }
    clause.repeated = true;
  }

  return {
    clauses: [
      ...(failed ? [{ category: 'failure' as const }] : []),
      ...[...clauses.values()].map(({ descriptor, repeated }) =>
        repeated ? { category: descriptor.category } : descriptor,
      ),
    ],
  };
}

function describeActivityItem(item: ActivityRunItem): ActivityItemDescriptor {
  if (item.kind === 'reasoning') {
    return descriptor('thinking', contentPreview(item.blocks));
  }

  const category = toolCategory(item.toolCall.kind);
  return descriptor(category, toolDetail(item));
}

function toolDetail(item: Extract<ActivityRunItem, { kind: 'tool' }>): string {
  const { toolCall } = item;
  switch (toolCall.kind) {
    case 'read':
    case 'edit':
    case 'delete':
    case 'move':
      return toolCallFilePresentation(toolCall)?.label ?? toolCallDisplayTitle(toolCall);
    case 'search':
      return toolCallSearchQuery(toolCall) ?? toolCallDisplayTitle(toolCall);
    case 'execute':
      return toolCallCommand(toolCall) ?? toolCallDisplayTitle(toolCall);
    case 'fetch': {
      const url = toolCallFetchUrl(toolCall);
      return url && URL.canParse(url) ? new URL(url).hostname : '';
    }
    case 'think':
      return toolCallDisplayTitle(toolCall);
    case 'other':
      return mcpToolName(toolCall.title)?.server ?? toolCallDisplayTitle(toolCall);
    default:
      return toolCall.kind satisfies never;
  }
}

function toolCategory(kind: ActivityToolKind): ActivityCategory {
  switch (kind) {
    case 'edit':
    case 'delete':
    case 'move':
      return 'files';
    case 'other':
      return 'integration';
    case 'execute':
      return 'command';
    case 'read':
    case 'search':
    case 'fetch':
      return 'explore';
    case 'think':
      return 'thinking';
    default:
      return kind satisfies never;
  }
}

function descriptor(category: ActivityCategory, detail: string): ActivityItemDescriptor {
  const boundedDetail = bounded(detail);
  return boundedDetail ? { category, detail: boundedDetail } : { category };
}

function bounded(value: string): string {
  const normalized = value.replaceAll(RE_WHITESPACE, ' ').trim();
  if (SENSITIVE_DETAIL_PATTERN.test(normalized)) return '';
  const characters = [...normalized];
  return characters.length <= DETAIL_MAX_LENGTH
    ? normalized
    : `${characters.slice(0, DETAIL_MAX_LENGTH - 1).join('')}…`;
}
