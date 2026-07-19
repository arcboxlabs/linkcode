import type { ToolCallContent } from '@linkcode/schema';

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;

/**
 * Convert one file's unified diff (codex app-server `fileChange.changes[].diff`) into structured
 * diff blocks, one per hunk: old side (context + removed) vs new side (context + added), the same
 * shape claude-code's Edit input produces. A pure-insertion hunk with no context omits `oldText`
 * (renders all-added, like a Write); text without any hunk header falls back to one all-added block.
 */
export function diffContentFromUnified(path: string, diff: string): ToolCallContent[] {
  if (diff.length === 0) return [];
  const lines = diff.split('\n');
  // A diff ending in '\n' splits into a trailing '' that is not a content line.
  if (lines.at(-1) === '') lines.pop();
  const blocks: ToolCallContent[] = [];
  let oldLines: string[] | null = null;
  let newLines: string[] | null = null;

  const flush = (): void => {
    if (oldLines === null || newLines === null) return;
    blocks.push({
      type: 'diff',
      path,
      oldText: oldLines.length > 0 ? oldLines.join('\n') : undefined,
      newText: newLines.join('\n'),
    });
    oldLines = null;
    newLines = null;
  };

  for (const line of lines) {
    if (HUNK_HEADER_RE.test(line)) {
      flush();
      oldLines = [];
      newLines = [];
      continue;
    }
    if (oldLines === null || newLines === null) continue; // file headers before the first hunk
    if (line[0] === '+') {
      newLines.push(line.slice(1));
    } else if (line[0] === '-') {
      oldLines.push(line.slice(1));
    } else if (line[0] === ' ' || line.length === 0) {
      // Some producers strip the leading space off blank context lines, leaving ''.
      const text = line.slice(1);
      oldLines.push(text);
      newLines.push(text);
    }
    // '\ No newline at end of file' and any other marker lines are dropped.
  }
  flush();

  if (blocks.length === 0) {
    return [{ type: 'diff', path, newText: diff }];
  }
  return blocks;
}
