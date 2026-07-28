import type { ContentBlock, ToolCall, ToolCallContent } from '@linkcode/schema';
import { ContentBlockSchema, textBlock } from '@linkcode/schema';

export const TOOL_PATH_KEYS = ['file_path', 'path', 'file', 'notebook_path', 'filePath'] as const;
const CLAUDE_SYSTEM_REMINDER_OPEN = '<system-reminder>';
const CLAUDE_SYSTEM_REMINDER_CLOSE = '</system-reminder>\n';

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
  // `code`/`codeText` is Claude's WebFetch envelope ("200 OK"); status/statusCode are the rest.
  const status = output?.status ?? output?.statusCode ?? output?.code;
  if (typeof status !== 'string' && typeof status !== 'number') return undefined;
  const statusText = output?.codeText;
  return typeof statusText === 'string' && statusText.length > 0
    ? `${status} ${statusText}`
    : String(status);
}

/** Canonical `content` wins; Pi and live Codex MCP may leave user-facing blocks only in
 * `rawOutput.content`, so fallbacks project known result fields and never stringify the envelope. */
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

/** Claude's Read result numbers every line and may prepend an unnumbered system reminder.
 * ToolCall carries no adapter id, so unwrap only the exact Claude title/input shape and a
 * complete consecutive run. */
export function toolCallReadPreviewText(toolCall: ToolCall, text: string): string {
  const input = recordValue(toolCall.rawInput);
  if (
    toolCall.kind !== 'read' ||
    toolCall.title !== 'Read' ||
    !stringValue(input, ['file_path']) ||
    text.length === 0
  ) {
    return text;
  }

  let numberedText = text;
  if (text.startsWith(CLAUDE_SYSTEM_REMINDER_OPEN)) {
    const reminderEnd = text.indexOf(CLAUDE_SYSTEM_REMINDER_CLOSE);
    if (reminderEnd === -1) return text;
    numberedText = text.slice(reminderEnd + CLAUDE_SYSTEM_REMINDER_CLOSE.length);
    if (numberedText.length === 0) return text;
  }

  const offset = input?.offset;
  if (
    offset !== undefined &&
    (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 1)
  ) {
    return text;
  }

  let cursor = 0;
  let expectedLine = typeof offset === 'number' ? offset : 1;
  const lines: string[] = [];
  while (cursor < numberedText.length) {
    const lineFeed = numberedText.indexOf('\n', cursor);
    const lineEnd = lineFeed === -1 ? numberedText.length : lineFeed;
    let prefixEnd = cursor;
    while (prefixEnd < lineEnd) {
      const codePoint = numberedText.codePointAt(prefixEnd);
      if (codePoint === undefined || codePoint < 48 || codePoint > 57) break;
      prefixEnd += 1;
    }

    if (prefixEnd === cursor || numberedText.codePointAt(prefixEnd) !== 9) return text;
    const lineNumber = Number.parseInt(numberedText.slice(cursor, prefixEnd), 10);
    if (lineNumber !== expectedLine || !Number.isSafeInteger(lineNumber) || lineNumber < 1) {
      return text;
    }

    expectedLine = lineNumber + 1;
    lines.push(numberedText.slice(prefixEnd + 1, lineFeed === -1 ? lineEnd : lineFeed + 1));
    if (lineFeed === -1) break;
    cursor = lineFeed + 1;
  }

  return lines.join('');
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
  if (typeof rawOutput === 'string' && toolCall.kind !== 'execute' && rawOutput.length > 0) {
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
