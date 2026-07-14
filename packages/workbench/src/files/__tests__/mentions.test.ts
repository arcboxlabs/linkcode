// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileMentionSource } from '../mentions';

const { useDataMock } = vi.hoisted(() => ({ useDataMock: vi.fn() }));

vi.mock('../../runtime/tayori', () => ({ useData: useDataMock }));

interface MentionRequest {
  cwd: string;
  limit: number;
  query: string;
}

function latestRequest(): MentionRequest | null {
  return useDataMock.mock.lastCall?.[1] as MentionRequest | null;
}

beforeEach(() => {
  useDataMock.mockImplementation((_operation: unknown, request: MentionRequest | null) => ({
    data: request
      ? [{ path: request.cwd === '/project-a' ? 'src/a.ts' : 'src/b.ts' }]
      : [{ path: 'src/stale.ts' }],
  }));
});

afterEach(() => {
  cleanup();
  useDataMock.mockReset();
});

describe('useFileMentionSource', () => {
  it('closes the old query when cwd changes and opens a new scoped query on demand', () => {
    const initialProps: { cwd: string | undefined } = { cwd: '/project-a' };
    const { result, rerender } = renderHook(
      ({ cwd }: { cwd: string | undefined }) => useFileMentionSource(cwd),
      { initialProps },
    );

    act(() => result.current.onMentionQueryChange(''));
    expect(latestRequest()).toEqual({ cwd: '/project-a', limit: 50, query: '' });
    expect(result.current.mentionItems.map((item) => item.value)).toEqual(['src/a.ts']);

    rerender({ cwd: '/project-b' });
    expect(latestRequest()).toBeNull();
    expect(result.current.mentionItems).toEqual([]);

    act(() => result.current.onMentionQueryChange(''));
    expect(latestRequest()).toEqual({ cwd: '/project-b', limit: 50, query: '' });
    expect(result.current.mentionItems.map((item) => item.value)).toEqual(['src/b.ts']);

    rerender({ cwd: undefined });
    expect(latestRequest()).toBeNull();
    expect(result.current.mentionItems).toEqual([]);
  });
});
