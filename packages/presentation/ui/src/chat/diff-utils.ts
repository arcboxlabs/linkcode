import type { ToolCall } from '@linkcode/schema';
import { createFixedArray } from 'foxact/create-fixed-array';

export interface DiffRow {
  id: string;
  type: 'add' | 'del' | 'ctx';
  text: string;
}

// Strip one trailing newline: "added\n".split('\n') would count a phantom extra line.
const TRAILING_NEWLINE_RE = /\n$/;

export function diffLines(oldStr: string, newStr: string): DiffRow[] {
  // An empty side means zero lines (created / deleted file); ''.split('\n') would yield [''] — a phantom row.
  const oldLines = oldStr ? oldStr.replace(TRAILING_NEWLINE_RE, '').split('\n') : [];
  const newLines = newStr ? newStr.replace(TRAILING_NEWLINE_RE, '').split('\n') : [];
  const m = oldLines.length;
  const n = newLines.length;

  // The LCS DP matrix is O(m*n) cells and reallocates per render; above ~250k cells, skip
  // alignment and fall back to a trivial diff (all old lines removed, all new lines added).
  if (m * n > 250000) {
    const rows: DiffRow[] = [];
    for (let i = 0; i < m; i++) {
      rows.push({ id: String(rows.length), type: 'del', text: oldLines[i] });
    }
    for (let j = 0; j < n; j++) {
      rows.push({ id: String(rows.length), type: 'add', text: newLines[j] });
    }
    return rows;
  }

  const lcs: number[][] = createFixedArray(m + 1).map(() => createFixedArray(n + 1).map(() => 0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        lcs[i][j] = lcs[i + 1][j + 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
  }

  const rows: DiffRow[] = [];
  const push = (type: DiffRow['type'], text: string): void => {
    rows.push({ id: String(rows.length), type, text });
  };
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      push('ctx', oldLines[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('del', oldLines[i]);
      i++;
    } else {
      push('add', newLines[j]);
      j++;
    }
  }
  while (i < m) {
    push('del', oldLines[i]);
    i++;
  }
  while (j < n) {
    push('add', newLines[j]);
    j++;
  }

  return rows;
}

/** Parse display rows from a git/unified patch. File and hunk headers are metadata, not changes. */
export function patchLines(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let inHunk = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith(String.raw`\ No newline at end of file`)) continue;
    const prefix = line[0];
    if (prefix !== '+' && prefix !== '-' && prefix !== ' ') continue;
    rows.push({
      id: String(rows.length),
      type: prefix === '+' ? 'add' : prefix === '-' ? 'del' : 'ctx',
      text: line.slice(1),
    });
  }
  return rows;
}

/** Line-level add/delete counts for a diff, shared with group headers that sum across files. */
export interface DiffStats {
  additions: number;
  deletions: number;
}

export function diffStats(
  oldText: string | undefined,
  newText: string | undefined,
  patch?: string,
): DiffStats {
  const rows = patch === undefined ? diffLines(oldText ?? '', newText ?? '') : patchLines(patch);
  return {
    additions: rows.filter((row) => row.type === 'add').length,
    deletions: rows.filter((row) => row.type === 'del').length,
  };
}

export type DiffToolCallContent = Extract<ToolCall['content'][number], { type: 'diff' }>;

// diffStats runs an O(m×n) LCS; the builder replaces content objects instead of mutating them,
// so object identity is a sound cache key across re-renders and re-folds.
const diffContentStatsCache = new WeakMap<DiffToolCallContent, DiffStats>();

export function diffContentStats(content: DiffToolCallContent): DiffStats {
  const cached = diffContentStatsCache.get(content);
  if (cached) return cached;
  const stats = diffStats(content.oldText, content.newText, content.patch?.text);
  diffContentStatsCache.set(content, stats);
  return stats;
}

export function toolCallDiffStats(toolCall: Pick<ToolCall, 'content'>): DiffStats {
  let additions = 0;
  let deletions = 0;
  for (const content of toolCall.content) {
    if (content.type !== 'diff') continue;
    const stats = diffContentStats(content);
    additions += stats.additions;
    deletions += stats.deletions;
  }
  return { additions, deletions };
}
