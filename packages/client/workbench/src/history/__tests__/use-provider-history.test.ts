// @vitest-environment jsdom

import type { AgentHistoryListResult, AgentKind } from '@linkcode/schema';
import { AgentHistoryIdSchema } from '@linkcode/schema';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProviderHistory } from '../use-provider-history';

const { useDataMock, useMutationMock } = vi.hoisted(() => ({
  useDataMock: vi.fn(),
  useMutationMock: vi.fn(),
}));

vi.mock('../../runtime/tayori', () => ({
  useData: useDataMock,
  useMutation: useMutationMock,
}));

interface HistoryResponse {
  data?: AgentHistoryListResult;
  error?: unknown;
}

interface HistoryRequest {
  agentKind: AgentKind;
  opts: { limit: number };
}

interface HistoryDataOptions {
  keepPreviousData?: boolean;
}

const responses = new Map<AgentKind, HistoryResponse>();
const codexSessionId = AgentHistoryIdSchema.parse('codex-session');
const claudeSessionId = AgentHistoryIdSchema.parse('claude-session');
const lateCodexSessionId = AgentHistoryIdSchema.parse('late-codex-session');

beforeEach(() => {
  let previousData: AgentHistoryListResult | undefined;
  let previousKind: AgentKind | undefined;

  useDataMock.mockImplementation(
    (_operation: unknown, request: HistoryRequest, options?: HistoryDataOptions) => {
      const response = responses.get(request.agentKind) ?? {};
      const changedProvider = previousKind !== undefined && previousKind !== request.agentKind;
      const data =
        response.data === undefined && changedProvider && options?.keepPreviousData !== false
          ? previousData
          : response.data;

      if (response.data !== undefined) previousData = response.data;
      previousKind = request.agentKind;

      return {
        data,
        error: response.error,
        isLoading: data === undefined && response.error === undefined,
        mutate: vi.fn(),
      };
    },
  );
  useMutationMock.mockReturnValue({ trigger: vi.fn() });
});

afterEach(() => {
  cleanup();
  responses.clear();
  useDataMock.mockReset();
  useMutationMock.mockReset();
});

describe('useProviderHistory', () => {
  it('does not retain an installed provider list when the next provider cannot be scanned', () => {
    responses.set('codex', {
      data: {
        sessions: [{ historyId: codexSessionId, kind: 'codex', title: 'Codex chat' }],
      },
    });
    const unavailable = new Error('pi: history list is not supported');
    responses.set('pi', { error: unavailable });

    const { result, rerender } = renderHook(
      ({ kind }: { kind: AgentKind }) => useProviderHistory(kind),
      { initialProps: { kind: 'codex' } },
    );
    expect(result.current.entries.map((entry) => entry.historyId)).toEqual([codexSessionId]);

    rerender({ kind: 'pi' });

    expect(result.current.entries).toEqual([]);
    expect(result.current.loadError).toBe(unavailable);
    expect(useDataMock.mock.lastCall?.[1]).toEqual({
      agentKind: 'pi',
      opts: { limit: 200 },
    });
    expect(useDataMock.mock.lastCall?.[2]).toEqual({ keepPreviousData: false });
  });

  it('keeps late results scoped to their provider during rapid switches and restores its cache', () => {
    responses.set('claude-code', {
      data: {
        sessions: [{ historyId: claudeSessionId, kind: 'claude-code', title: 'Claude chat' }],
      },
    });

    const { result, rerender } = renderHook(
      ({ kind }: { kind: AgentKind }) => useProviderHistory(kind),
      { initialProps: { kind: 'claude-code' } },
    );
    expect(result.current.entries.map((entry) => entry.historyId)).toEqual([claudeSessionId]);

    rerender({ kind: 'codex' });
    expect(result.current.entries).toEqual([]);
    expect(result.current.isLoading).toBe(true);

    rerender({ kind: 'opencode' });
    expect(result.current.entries).toEqual([]);

    responses.set('codex', {
      data: {
        sessions: [{ historyId: lateCodexSessionId, kind: 'codex', title: 'Codex chat' }],
      },
    });
    rerender({ kind: 'opencode' });
    expect(result.current.entries).toEqual([]);

    rerender({ kind: 'codex' });
    expect(result.current.entries.map((entry) => entry.historyId)).toEqual([lateCodexSessionId]);
  });
});
