import type { ToolCallContent, ToolDiffChange } from '@linkcode/schema';

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;
const MOVE_TRAILER_RE = /\n\nMoved to: [^\n]+$/;

interface UnifiedDiffOptions {
  change?: ToolDiffChange;
  oldPath?: string;
}

/**
 * Convert one file's unified diff (codex app-server `fileChange.changes[].diff`) into one
 * structured diff. The original patch remains authoritative for rendering; old/new hunk text is
 * retained as a legacy fallback without requiring whole-file snapshots.
 */
export function diffContentFromUnified(
  path: string,
  diff: string,
  options: UnifiedDiffOptions = {},
): ToolCallContent[] {
  if (diff.length === 0) return [];
  const patchText = diff.replace(MOVE_TRAILER_RE, '');
  const lines = patchText.split('\n');
  // A diff ending in '\n' splits into a trailing '' that is not a content line.
  if (lines.at(-1) === '') lines.pop();
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let inHunk = false;

  for (const line of lines) {
    if (HUNK_HEADER_RE.test(line)) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue; // file headers before the first hunk
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

  return [
    {
      type: 'diff',
      change: options.change ?? 'modify',
      path,
      oldPath: options.oldPath,
      oldText: oldLines.length > 0 ? oldLines.join('\n') : undefined,
      newText: inHunk ? newLines.join('\n') : undefined,
      patch: { format: 'git_patch', text: patchText },
    },
  ];
}
