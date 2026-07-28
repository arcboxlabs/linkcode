import type { ToolCall } from '@linkcode/schema';
import {
  BotIcon,
  FileOutputIcon,
  FileTextIcon,
  GlobeIcon,
  PencilIcon,
  SearchIcon,
  SparklesIcon,
  TerminalIcon,
  Trash2Icon,
  WrenchIcon,
} from 'lucide-react';
import prettyBytes from 'pretty-bytes';
import prettyMilliseconds from 'pretty-ms';
import { toolCallFilePresentation } from './file-tool-presentation';
import {
  recordValue,
  stringValue,
  toolCallDisplayContent,
  toolCallExecuteText,
  toolCallFetchStatus,
  toolCallFetchUrl,
  toolCallSearchQuery,
} from './tool-result-content';

export type ToolMetadataKey =
  | 'duration'
  | 'files'
  | 'matches'
  | 'param'
  | 'query'
  | 'size'
  | 'status'
  | 'url';

export interface ToolMetadata {
  key: ToolMetadataKey;
  /** Verbatim label (a tool's own parameter name); when absent the key is localized. */
  label?: string;
  value: string;
  tone?: 'error';
}

function countValue(value: unknown): number | undefined {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export interface McpToolName {
  server: string;
  tool: string;
}

/** Splits Claude Code's `mcp__<server>__<tool>` slug on the first `__` after the prefix (server
 * keys never contain `__`; tool names may). Non-matching titles — including other adapters' MCP
 * formats — return undefined and display verbatim. */
export function mcpToolName(title: string): McpToolName | undefined {
  if (!title.startsWith('mcp__')) return undefined;
  const rest = title.slice(5);
  const separator = rest.indexOf('__');
  if (separator <= 0 || separator + 2 >= rest.length) return undefined;
  return { server: rest.slice(0, separator), tool: rest.slice(separator + 2) };
}

/** The human-facing tool name: MCP slugs shed their `mcp__<server>__` envelope. */
export function toolCallDisplayTitle(toolCall: ToolCall): string {
  return mcpToolName(toolCall.title)?.tool ?? toolCall.title;
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

/**
 * Curated normal-mode metadata: classified kinds project only their known fields, and an
 * unclassified (`other`) call shows its scalar input params. Raw payloads are never dumped
 * wholesale — nested objects/arrays (request envelopes, credentials, bulk content) stay in
 * the model, not the transcript.
 */
export function toolCallMetadata(toolCall: ToolCall): ToolMetadata[] {
  const output = recordValue(toolCall.rawOutput);

  switch (toolCall.kind) {
    case 'read':
    case 'edit':
    case 'delete':
    case 'move':
      return [];
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
      const duration = numberValue(output?.durationMs);
      if (duration !== undefined) {
        metadata.push({ key: 'duration', value: prettyMilliseconds(duration) });
      }
      const bytes = numberValue(output?.bytes);
      if (bytes !== undefined) metadata.push({ key: 'size', value: prettyBytes(bytes) });
      return metadata;
    }
    case 'other':
      return toolCallParamMetadata(toolCall);
    case 'execute':
    case 'think':
    case 'task':
      return [];
    default:
      return toolCall.kind satisfies never;
  }
}

const PARAM_BADGE_LIMIT = 8;
const PARAM_VALUE_MAX = 160;

/** Scalar inputs of an unclassified call, labeled by the tool's own param names (verbatim —
 * they aren't localizable). Bounded so one badge is a detail, not a payload dump. */
function toolCallParamMetadata(toolCall: ToolCall): ToolMetadata[] {
  const input = recordValue(toolCall.rawInput);
  if (!input) return [];
  const metadata: ToolMetadata[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (metadata.length >= PARAM_BADGE_LIMIT) break;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      continue;
    }
    const text = String(value);
    if (text.length === 0) continue;
    metadata.push({
      key: 'param',
      label: key,
      value: text.length > PARAM_VALUE_MAX ? `${text.slice(0, PARAM_VALUE_MAX)}…` : text,
    });
  }
  return metadata;
}

export interface ToolCallHeaderSummary {
  label: string;
  tooltip?: string;
}

/** One compact, non-debug detail for singleton tool headers. */
export function toolCallHeaderSummary(toolCall: ToolCall): ToolCallHeaderSummary | undefined {
  let label: string | undefined;
  switch (toolCall.kind) {
    case 'execute':
      label = toolCallCommand(toolCall);
      break;
    case 'read':
    case 'edit':
    case 'delete':
    case 'move': {
      const file = toolCallFilePresentation(toolCall);
      if (file) return { label: file.label, tooltip: file.tooltip };
      break;
    }
    case 'search':
      label = toolCallSearchQuery(toolCall);
      break;
    case 'fetch':
      label = toolCallFetchUrl(toolCall);
      break;
    case 'think':
    case 'task':
    case 'other':
      break;
    default:
      return toolCall.kind satisfies never;
  }
  return label ? { label } : undefined;
}

/** Header context beside a visible tool name: the kind summary, else — for an MCP call, whose
 * name alone doesn't say where it runs — the server (full slug on hover). */
export function toolCallContextSummary(toolCall: ToolCall): ToolCallHeaderSummary | undefined {
  const summary = toolCallHeaderSummary(toolCall);
  if (summary) return summary;
  const mcp = mcpToolName(toolCall.title);
  return mcp ? { label: mcp.server, tooltip: toolCall.title } : undefined;
}

export function hasToolBody(toolCall: ToolCall): boolean {
  if (toolCallDisplayContent(toolCall).length > 0) return true;
  if (toolCallFilePresentation(toolCall)) return true;
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
  think: SparklesIcon,
  fetch: GlobeIcon,
  task: BotIcon,
  other: WrenchIcon,
};
