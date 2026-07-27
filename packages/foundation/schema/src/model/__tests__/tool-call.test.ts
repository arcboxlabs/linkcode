import { describe, expect, it } from 'vitest';
import { ToolCallContentSchema, unifiedPatchText } from '../tool-call';

describe('ToolCallContentSchema diff', () => {
  it('keeps legacy oldText/newText diffs readable', () => {
    expect(
      ToolCallContentSchema.parse({
        type: 'diff',
        path: 'src/a.ts',
        oldText: 'before',
        newText: 'after',
      }),
    ).toEqual({ type: 'diff', path: 'src/a.ts', oldText: 'before', newText: 'after' });
  });

  it.each([
    { change: 'delete', path: 'removed.bin', isBinary: true },
    { change: 'move', oldPath: 'old.ts', path: 'new.ts' },
    {
      change: 'modify',
      path: 'large.ts',
      patch: { format: 'git_patch', text: '@@ -1 +1 @@\n-old\n+new' },
    },
  ])('accepts a structured $change diff without dual full text', (diff) => {
    expect(ToolCallContentSchema.safeParse({ type: 'diff', ...diff }).success).toBe(true);
  });
});

describe('unifiedPatchText', () => {
  it('emits a header per hunk followed by that hunk body', () => {
    expect(
      unifiedPatchText([
        { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' same', '-before'] },
        { oldStart: 40, oldLines: 1, newStart: 40, newLines: 2, lines: ['+added', ' tail'] },
      ]),
    ).toBe('@@ -1,2 +1,2 @@\n same\n-before\n@@ -40,1 +40,2 @@\n+added\n tail');
  });

  it('renders no hunks as empty text', () => {
    expect(unifiedPatchText([])).toBe('');
  });
});
