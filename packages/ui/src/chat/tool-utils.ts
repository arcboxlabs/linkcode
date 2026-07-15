import type { ToolCall } from '@linkcode/schema';
import {
  BotIcon,
  BrainIcon,
  FileOutputIcon,
  FileTextIcon,
  GlobeIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  Trash2Icon,
  WrenchIcon,
} from 'lucide-react';
import {
  recordValue,
  stringValue,
  TOOL_PATH_KEYS,
  toolCallDisplayContent,
  toolCallExecuteText,
  toolCallFetchStatus,
  toolCallFetchUrl,
  toolCallFilePath,
  toolCallSearchQuery,
} from './tool-result-content';

export type ToolMetadataKey = 'files' | 'matches' | 'path' | 'query' | 'status' | 'url';

export interface ToolMetadata {
  key: ToolMetadataKey;
  value: string;
  tone?: 'error';
}

const MOVE_SOURCE_KEYS = ['source', 'from', 'old_path', 'oldPath', ...TOOL_PATH_KEYS] as const;
const MOVE_DESTINATION_KEYS = ['destination', 'to', 'new_path', 'newPath', 'move_path'] as const;

function countValue(value: unknown): number | undefined {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  return undefined;
}

function fileSummary(toolCall: ToolCall): string | undefined {
  if (toolCall.kind === 'move') {
    const input = recordValue(toolCall.rawInput);
    const source = stringValue(input, MOVE_SOURCE_KEYS);
    const destination = stringValue(input, MOVE_DESTINATION_KEYS);
    if (source && destination) return `${source} → ${destination}`;
  }

  const path = toolCallFilePath(toolCall);
  const location = toolCall.locations?.find((item) => item.path === path);
  return path && location?.line !== undefined ? `${path}:${location.line}` : path;
}

export function toolCallCommand(toolCall: ToolCall): string | undefined {
  const input = recordValue(toolCall.rawInput);
  const command = input?.command ?? input?.cmd;
  if (typeof command === 'string' && command.length > 0) return command;
  if (Array.isArray(command) && command.every((part) => typeof part === 'string')) {
    return command.join(' ');
  }
  return undefined;
}

export function toolCallFailureMessage(toolCall: ToolCall): string | undefined {
  if (toolCall.status !== 'failed') return undefined;
  return stringValue(recordValue(toolCall.rawOutput), ['message']);
}

/** Whitelisted normal-mode metadata. Arbitrary raw payloads stay in the model, not the transcript. */
export function toolCallMetadata(toolCall: ToolCall): ToolMetadata[] {
  const output = recordValue(toolCall.rawOutput);

  switch (toolCall.kind) {
    case 'read':
    case 'move': {
      const path = fileSummary(toolCall);
      return path ? [{ key: 'path', value: path }] : [];
    }
    case 'edit':
    case 'delete': {
      if (toolCall.content.some((content) => content.type === 'diff')) return [];
      const path = fileSummary(toolCall);
      return path ? [{ key: 'path', value: path }] : [];
    }
    case 'search': {
      const metadata: ToolMetadata[] = [];
      const query = toolCallSearchQuery(toolCall);
      if (query) metadata.push({ key: 'query', value: query });
      const matches = countValue(output?.matches);
      if (matches !== undefined) metadata.push({ key: 'matches', value: String(matches) });
      const files = countValue(output?.files);
      if (files !== undefined) metadata.push({ key: 'files', value: String(files) });
      return metadata;
    }
    case 'fetch': {
      const metadata: ToolMetadata[] = [];
      const url = toolCallFetchUrl(toolCall);
      if (url) metadata.push({ key: 'url', value: url });
      const status = toolCallFetchStatus(toolCall);
      if (status) {
        metadata.push({
          key: 'status',
          value: status,
          tone: toolCall.status === 'failed' ? 'error' : undefined,
        });
      }
      return metadata;
    }
    case 'execute':
    case 'think':
    case 'task':
    case 'other':
      return [];
    default:
      return toolCall.kind satisfies never;
  }
}

/** One compact, non-debug detail for singleton headers and collapsed group summaries. */
export function toolCallSummary(toolCall: ToolCall): string | undefined {
  switch (toolCall.kind) {
    case 'execute':
      return toolCallCommand(toolCall);
    case 'read':
    case 'edit':
    case 'delete':
    case 'move':
      return fileSummary(toolCall);
    case 'search':
      return toolCallSearchQuery(toolCall);
    case 'fetch':
      return toolCallFetchUrl(toolCall);
    case 'think':
    case 'task':
    case 'other':
      return undefined;
    default:
      return toolCall.kind satisfies never;
  }
}

export function hasToolBody(toolCall: ToolCall): boolean {
  if (toolCallDisplayContent(toolCall).length > 0) return true;
  if (toolCall.kind === 'execute') {
    if (toolCallCommand(toolCall)) return true;
    if (toolCallExecuteText(toolCall)) return true;
  }
  return toolCallMetadata(toolCall).length > 0 || toolCallFailureMessage(toolCall) !== undefined;
}

export const TOOL_KIND_ICONS: Record<
  ToolCall['kind'],
  React.ComponentType<{ className?: string }>
> = {
  read: FileTextIcon,
  edit: PencilIcon,
  delete: Trash2Icon,
  move: FileOutputIcon,
  search: SearchIcon,
  execute: TerminalIcon,
  think: BrainIcon,
  fetch: GlobeIcon,
  task: BotIcon,
  other: WrenchIcon,
};
