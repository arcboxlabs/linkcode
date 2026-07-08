import type { ToolCall, ToolCallContent } from '@linkcode/schema';
import { isRecord } from '../../history-util';
import { diffContentFromUnified } from '../../unified-diff';
import { toolKindFromName } from '../../util';

/**
 * Tool-rendering helpers shared by the live adapter (`adapter.ts`) and the history mapper
 * (`history.ts`): tool-kind classification and the file-mutation diff extraction. They live in
 * their own module so `history.ts` can reuse them without importing `adapter.ts`, which imports
 * `history.ts` back — a cycle. Live turns and cold-resume replay must classify and render a tool
 * IDENTICALLY, so there is exactly one implementation of each.
 */

/** Amp's subagent-spawning tool is `Task`; exact match (not the shared regex classifier) for the
 * same reason claude-code matches its `Agent`/`Task` exactly — see `claudeToolKind`. */
export function ampToolKind(name: string): ToolCall['kind'] {
  return name === 'Task' ? 'task' : toolKindFromName(name);
}

/** `+++ <path>` (a `\t<label>` may trail it); a deletion's `+++ /dev/null` falls back to `---`. */
const DIFF_NEW_FILE_RE = /^\+{3} ([^\t\n]+)/m;
const DIFF_OLD_FILE_RE = /^-{3} ([^\t\n]+)/m;

function pathFromUnifiedDiff(diff: string): string | undefined {
  const newPath = DIFF_NEW_FILE_RE.exec(diff)?.[1];
  const path =
    newPath === undefined || newPath === '/dev/null' ? DIFF_OLD_FILE_RE.exec(diff)?.[1] : newPath;
  return path === undefined || path === '/dev/null' ? undefined : path;
}

/** Amp's file-mutation tools carry their result as `{ diff: "<unified diff>", lineRange: [start,
 * end] }` — a JSON string on the live `tool_result.content`, and the same object already parsed
 * under a history export's `run.result`. Surface a matching diff as structured content so the UI
 * renders a diff card; anything without a usable diff returns undefined (the caller falls back to
 * plain text). */
export function diffContentFromResult(result: unknown): ToolCallContent[] | undefined {
  if (!isRecord(result) || typeof result.diff !== 'string' || result.diff.length === 0) {
    return undefined;
  }
  const path = pathFromUnifiedDiff(result.diff);
  if (path === undefined) return undefined;
  return diffContentFromUnified(path, result.diff);
}

/** Live path: the result rides `tool_result.content` as a JSON string. Parse, then reuse the
 * shared object-based extraction so live and replay produce the same diff content. */
export function diffResultContent(content: string): ToolCallContent[] | undefined {
  if (content[0] !== '{') return undefined;
  try {
    return diffContentFromResult(JSON.parse(content) as unknown);
  } catch {
    return undefined;
  }
}
