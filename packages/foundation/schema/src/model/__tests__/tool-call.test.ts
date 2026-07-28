import { describe, expect, it } from 'vitest';
import { ToolCallContentSchema } from '../tool-call';

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
