import type { ContentBlock, ToolCall, ToolCallContent } from '@linkcode/schema';
import { ContentBlockSchema, textBlock } from '@linkcode/schema';

export const TOOL_PATH_KEYS = ['file_path', 'path', 'file', 'notebook_path', 'filePath'] as const;

export function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function stringValue(
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

export function toolCallFilePath(toolCall: ToolCall): string | undefined {
  const location = toolCall.locations?.[0];
  if (location) return location.path;
  const diff = toolCall.content.find((content) => content.type === 'diff');
  if (diff?.type === 'diff') return diff.path;
  return stringValue(recordValue(toolCall.rawInput), TOOL_PATH_KEYS);
}

export function toolCallSearchQuery(toolCall: ToolCall): string | undefined {
  return stringValue(recordValue(toolCall.rawInput), ['query', 'pattern']);
}

export function toolCallFetchUrl(toolCall: ToolCall): string | undefined {
  return stringValue(recordValue(toolCall.rawInput), ['url', 'uri']);
}

export function toolCallFetchStatus(toolCall: ToolCall): string | undefined {
  const output = recordValue(toolCall.rawOutput);
  const status = output?.status ?? output?.statusCode;
  return typeof status === 'string' || typeof status === 'number' ? String(status) : undefined;
}

/**
 * Claude and OpenCode normally duplicate display text in canonical `content` and `rawOutput`,
 * while Pi and live Codex MCP may leave user-facing blocks in `rawOutput.content`. Canonical data
 * therefore wins; fallbacks project only known result fields and never stringify the envelope.
 */
export function toolCallDisplayContent(toolCall: ToolCall): ToolCallContent[] {
  if (toolCall.content.length > 0) return toolCall.content;
  return fallbackContent(toolCall).map((content) => ({ type: 'content', content }));
}

export function toolCallDisplayText(toolCall: ToolCall): string {
  return toolCallDisplayContent(toolCall)
    .flatMap((content) =>
      content.type === 'content' && content.content.type === 'text' ? [content.content.text] : [],
    )
    .join('\n');
}

export function toolCallExecuteText(toolCall: ToolCall): string | undefined {
  const displayText = toolCallDisplayText(toolCall);
  if (displayText) return displayText;
  if (typeof toolCall.rawOutput === 'string') return toolCall.rawOutput;
  return stringValue(recordValue(toolCall.rawOutput), ['message']);
}

function fallbackContent(toolCall: ToolCall): ContentBlock[] {
  const rawOutput = toolCall.rawOutput;
  const output = recordValue(rawOutput);
  const rawContent = output?.content;

  if (Array.isArray(rawContent)) {
    const projected = rawContent.flatMap((value) => {
      const result = ContentBlockSchema.safeParse(value);
      return result.success ? [result.data] : [];
    });
    if (projected.length > 0) return projected;
  }

  // Codex execute uses rawOutput for an exit code and the terminal path owns string output.
  if (toolCall.kind !== 'execute' && typeof rawOutput === 'string' && rawOutput.length > 0) {
    return [textBlock(rawOutput)];
  }

  const fallbackText = kindSpecificFallbackText(toolCall, output);
  return fallbackText ? [textBlock(fallbackText)] : [];
}

function kindSpecificFallbackText(
  toolCall: ToolCall,
  output: Record<string, unknown> | undefined,
): string | undefined {
  if (!output) return undefined;

  switch (toolCall.kind) {
    case 'search':
      return stringArrayFields(output, ['matches', 'files']);
    case 'fetch':
      return displayValue(output.body ?? output.responseBody ?? output.text ?? output.data);
    case 'other':
      return displayValue(output.structuredContent);
    case 'read':
    case 'edit':
    case 'delete':
    case 'move':
    case 'execute':
    case 'think':
    case 'task':
      return undefined;
    default:
      return toolCall.kind satisfies never;
  }
}

function stringArrayFields(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  const values = keys.flatMap((key) => {
    const value = record[key];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  });
  return values.length > 0 ? [...new Set(values)].join('\n') : undefined;
}

function displayValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.length > 0 ? value : undefined;
  if (value === undefined) return undefined;
  return JSON.stringify(value, null, 2);
}
