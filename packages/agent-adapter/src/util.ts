import type { ContentBlock, ToolCallLocation, ToolKind } from '@linkcode/schema';

const READ_TOOL_NAME_RE = /read|cat|view|open/;
const EDIT_TOOL_NAME_RE = /write|edit|apply|patch|create|update/;
const DELETE_TOOL_NAME_RE = /delete|remove|\brm\b/;
const MOVE_TOOL_NAME_RE = /move|rename|\bmv\b/;
const SEARCH_TOOL_NAME_RE = /search|grep|glob|find/;
const EXECUTE_TOOL_NAME_RE = /bash|exec|shell|\brun\b|command|terminal/;
const FETCH_TOOL_NAME_RE = /fetch|web|http|browser/;
const THINK_TOOL_NAME_RE = /think|plan|reason/;

/** Flatten content blocks into a single prompt string (text blocks only). */
export function contentToText(content: ContentBlock[]): string {
  return content
    .reduce<string[]>((texts, c) => {
      if (c.type === 'text') texts.push(c.text);
      return texts;
    }, [])
    .join('\n');
}

const PATH_INPUT_KEYS = ['file_path', 'path', 'notebook_path', 'filePath'] as const;

/** Best-effort file location from a tool's raw input (drives produced-file cards and
 * the follow-along affordance). Vendors without a conventional path field return none. */
export function locationsFromToolInput(input: unknown): ToolCallLocation[] | undefined {
  if (input === null || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  for (const key of PATH_INPUT_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return [{ path: value }];
  }
  return undefined;
}

/** Best-effort mapping of a tool name to an ACP ToolKind (drives UI iconography). */
export function toolKindFromName(name: string): ToolKind {
  const n = name.toLowerCase();
  if (READ_TOOL_NAME_RE.test(n)) return 'read';
  if (EDIT_TOOL_NAME_RE.test(n)) return 'edit';
  if (DELETE_TOOL_NAME_RE.test(n)) return 'delete';
  if (MOVE_TOOL_NAME_RE.test(n)) return 'move';
  if (SEARCH_TOOL_NAME_RE.test(n)) return 'search';
  if (EXECUTE_TOOL_NAME_RE.test(n)) return 'execute';
  if (FETCH_TOOL_NAME_RE.test(n)) return 'fetch';
  if (THINK_TOOL_NAME_RE.test(n)) return 'think';
  return 'other';
}
