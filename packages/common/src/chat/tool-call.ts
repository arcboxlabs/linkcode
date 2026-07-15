import type { ContentBlock, ToolCall } from '@linkcode/schema';
import { ContentBlockSchema } from '@linkcode/schema';

export type ToolMetadataKey = 'files' | 'matches' | 'path' | 'query' | 'status' | 'url';

export interface ToolMetadata {
  key: ToolMetadataKey;
  value: string;
  tone?: 'error';
}

const PATH_KEYS = ['file_path', 'path', 'notebook_path', 'filePath'] as const;
const MOVE_SOURCE_KEYS = ['source', 'from', 'old_path', 'oldPath', ...PATH_KEYS] as const;
const MOVE_DESTINATION_KEYS = ['destination', 'to', 'new_path', 'newPath', 'move_path'] as const;

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(
  record: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

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

  const location = toolCall.locations?.[0];
  if (location) {
    return location.line === undefined ? location.path : `${location.path}:${location.line}`;
  }

  const diff = toolCall.content.find((content) => content.type === 'diff');
  if (diff?.type === 'diff') return diff.path;
  return stringValue(recordValue(toolCall.rawInput), PATH_KEYS);
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
 * Pi AgentToolResult and live Codex MCP results currently arrive in `rawOutput.content` while
 * canonical tool content is empty. Project only schema-valid content blocks so the useful result
 * survives without exposing the rest of either backend envelope in the transcript.
 */
export function toolCallFallbackContent(toolCall: ToolCall): ContentBlock[] {
  if (toolCall.content.length > 0) return [];
  const rawContent = recordValue(toolCall.rawOutput)?.content;
  if (!Array.isArray(rawContent)) return [];

  return rawContent.flatMap((value) => {
    const result = ContentBlockSchema.safeParse(value);
    return result.success ? [result.data] : [];
  });
}

/** Whitelisted normal-mode metadata. Arbitrary raw payloads stay in the model, not the transcript. */
export function toolCallMetadata(toolCall: ToolCall): ToolMetadata[] {
  const input = recordValue(toolCall.rawInput);
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
      const query = stringValue(input, ['query', 'pattern']);
      if (query) metadata.push({ key: 'query', value: query });
      const matches = countValue(output?.matches);
      if (matches !== undefined) metadata.push({ key: 'matches', value: String(matches) });
      const files = countValue(output?.files);
      if (files !== undefined) metadata.push({ key: 'files', value: String(files) });
      return metadata;
    }
    case 'fetch': {
      const metadata: ToolMetadata[] = [];
      const url = stringValue(input, ['url', 'uri']);
      if (url) metadata.push({ key: 'url', value: url });
      const status = output?.status ?? output?.statusCode;
      if (typeof status === 'string' || typeof status === 'number') {
        metadata.push({
          key: 'status',
          value: String(status),
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
      return stringValue(recordValue(toolCall.rawInput), ['query', 'pattern']);
    case 'fetch':
      return stringValue(recordValue(toolCall.rawInput), ['url', 'uri']);
    case 'think':
    case 'task':
    case 'other':
      return undefined;
    default:
      return toolCall.kind satisfies never;
  }
}

export function hasToolBody(toolCall: ToolCall): boolean {
  if (toolCall.content.length > 0) return true;
  if (toolCallFallbackContent(toolCall).length > 0) return true;
  if (toolCall.kind === 'execute') {
    if (toolCallCommand(toolCall)) return true;
    if (typeof toolCall.rawOutput === 'string') return true;
  }
  return toolCallMetadata(toolCall).length > 0 || toolCallFailureMessage(toolCall) !== undefined;
}
