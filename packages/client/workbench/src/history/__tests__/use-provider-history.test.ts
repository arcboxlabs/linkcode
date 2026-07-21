// @vitest-environment jsdom

import type {
  AgentHistoryId,
  AgentHistoryListResult,
  AgentHistorySession,
  AgentKind,
  SessionId,
} from '@linkcode/schema';
import { AgentHistoryIdSchema } from '@linkcode/schema';
import { cleanup, renderHook } from '@testing-library/react';
import { createFixedArray } from 'foxts/create-fixed-array';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importHistoryGroup, useProviderHistory } from '../use-provider-history';

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
    (_operation: unknown, request: HistoryRequest | object, options?: HistoryDataOptions) => {
      if (!('agentKind' in request)) return { mutate: vi.fn() };
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
    expect(useDataMock).toHaveBeenCalledWith(
      expect.anything(),
      { agentKind: 'pi', opts: { limit: 200 } },
      { keepPreviousData: false },
    );
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

function entry(historyId: string): AgentHistorySession {
  return {
    historyId: historyId as AgentHistoryId,
    kind: 'claude-code',
    cwd: '/work/linkcode',
  };
}

describe('importHistoryGroup', () => {
  it('imports every conversation in the directory', async () => {
    const importEntry = vi.fn((item: AgentHistorySession) =>
      Promise.resolve(`session-${item.historyId}` as SessionId),
    );
    const entries = [entry('one'), entry('two')];

    await expect(
      importHistoryGroup({
        cwd: '/work/linkcode',
        entries,
        inFlight: new Set(),
        importEntry,
      }),
    ).resolves.toEqual({ imported: ['one', 'two'], failures: [] });
    expect(importEntry).toHaveBeenCalledTimes(2);
  });

  it('waits for all imports and reports partial failures against the failed entries', async () => {
    const failure = new Error('history is unreadable');
    const entries = [entry('one'), entry('two'), entry('three')];
    const importEntry = vi.fn((item: AgentHistorySession) => {
      if (item.historyId === 'two') return Promise.reject(failure);
      return Promise.resolve(`session-${item.historyId}` as SessionId);
    });

    await expect(
      importHistoryGroup({
        cwd: '/work/linkcode',
        entries,
        inFlight: new Set(),
        importEntry,
      }),
    ).resolves.toEqual({
      imported: ['one', 'three'],
      failures: [{ historyId: 'two', error: failure }],
    });
    expect(importEntry).toHaveBeenCalledTimes(3);
  });

  it('limits the number of concurrent imports in a directory', async () => {
    let active = 0;
    let maxActive = 0;
    const importEntry = vi.fn(async (item: AgentHistorySession) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return `session-${item.historyId}` as SessionId;
    });

    await importHistoryGroup({
      cwd: '/work/linkcode',
      entries: createFixedArray(10).map((index) => entry(`entry-${index}`)),
      inFlight: new Set(),
      importEntry,
    });

    expect(importEntry).toHaveBeenCalledTimes(10);
    expect(maxActive).toBe(4);
  });

  it('drops a repeated click while the same directory import is in flight', async () => {
    let finishImport: ((sessionId: SessionId) => void) | undefined;
    const pendingImport = new Promise<SessionId>((resolve) => {
      finishImport = resolve;
    });
    const importEntry = vi.fn(() => pendingImport);
    const inFlight = new Set<string>();
    const options = {
      cwd: '/work/linkcode',
      entries: [entry('one')],
      inFlight,
      importEntry,
    };

    const first = importHistoryGroup(options);
    await expect(importHistoryGroup(options)).resolves.toBeNull();
    expect(importEntry).toHaveBeenCalledOnce();

    finishImport?.('session-one' as SessionId);
    await expect(first).resolves.toEqual({ imported: ['one'], failures: [] });
    expect(inFlight).toEqual(new Set());
  });
});
