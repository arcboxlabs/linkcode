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

interface MentionDataOptions {
  keepPreviousData?: boolean;
}

function latestRequest(): MentionRequest | null {
  return useDataMock.mock.lastCall?.[1] as MentionRequest | null;
}

beforeEach(() => {
  let previousData: Array<{ path: string }> | undefined;
  let previousCwd: string | undefined;
  useDataMock.mockImplementation(
    (_operation: unknown, request: MentionRequest | null, options?: MentionDataOptions) => {
      if (!request) return { data: [{ path: 'src/stale.ts' }] };
      const nextData = [{ path: request.cwd === '/project-a' ? 'src/a.ts' : 'src/b.ts' }];
      const keepsPreviousWorkspace =
        previousData !== undefined &&
        previousCwd !== request.cwd &&
        options?.keepPreviousData !== false;
      const data = keepsPreviousWorkspace ? previousData : nextData;
      previousData = nextData;
      previousCwd = request.cwd;
      return { data };
    },
  );
});

afterEach(() => {
  cleanup();
  useDataMock.mockReset();
});

describe('useFileMentionSource', () => {
  it('scopes each query to its supplied cwd', () => {
    const { result } = renderHook(() => useFileMentionSource());

    act(() => result.current.onMentionQueryChange('/project-a', ''));
    expect(latestRequest()).toEqual({ cwd: '/project-a', limit: 50, query: '' });
    expect(result.current.mentionItems.map((item) => item.value)).toEqual(['src/a.ts']);

    act(() => result.current.onMentionQueryChange('/project-b', ''));
    expect(latestRequest()).toEqual({ cwd: '/project-b', limit: 50, query: '' });
    expect(result.current.mentionItems.map((item) => item.value)).toEqual(['src/b.ts']);
  });

  it('hides stale results after closing and never reuses a previous trigger query', () => {
    const { result } = renderHook(() => useFileMentionSource());

    act(() => result.current.onMentionQueryChange('/project-a', 'old-query'));
    expect(latestRequest()).toEqual({ cwd: '/project-a', limit: 50, query: 'old-query' });

    act(() => result.current.onMentionQueryChange('/project-a', null));
    expect(latestRequest()).toBeNull();
    expect(result.current.mentionItems).toEqual([]);

    act(() => result.current.onMentionQueryChange('/project-b', 'new-query'));
    expect(latestRequest()).toEqual({ cwd: '/project-b', limit: 50, query: 'new-query' });
    expect(result.current.mentionItems.map((item) => item.value)).toEqual(['src/b.ts']);

    act(() => result.current.onMentionQueryChange(undefined, 'new-query'));
    expect(latestRequest()).toBeNull();
    expect(result.current.mentionItems).toEqual([]);
  });
});
