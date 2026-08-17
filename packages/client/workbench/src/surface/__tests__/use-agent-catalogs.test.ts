// @vitest-environment jsdom

import type { AgentRuntimes } from '@linkcode/schema';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAgentStartCatalogs } from '../use-agent-catalogs';

const tayoriMock = vi.hoisted(() => ({ params: [] as unknown[] }));
const runtimeMock = vi.hoisted(() => ({ runtimes: undefined as AgentRuntimes | undefined }));

vi.mock('../../runtime/tayori', () => ({
  useData(_operation: unknown, params: unknown) {
    tayoriMock.params.push(params);
    return { data: undefined };
  },
}));
vi.mock('../../agent-runtime/hooks', () => ({
  useAgentRuntimes: () => ({ data: runtimeMock.runtimes }),
}));

afterEach(() => {
  tayoriMock.params.length = 0;
  runtimeMock.runtimes = undefined;
});

describe('useAgentStartCatalogs', () => {
  it('pauses only the Pi catalog while runtime availability is loading', () => {
    renderHook(() => useAgentStartCatalogs('/repo/app'));

    // The cwd is what lets an adapter resolve the tier a session would really start under —
    // claude-code reads `permissions.defaultMode` from the workspace's own settings.
    expect(tayoriMock.params).toEqual([
      { agentKind: 'claude-code', cwd: '/repo/app' },
      { agentKind: 'codex', cwd: '/repo/app' },
      { agentKind: 'opencode', cwd: '/repo/app' },
      null,
      { agentKind: 'grok-build', cwd: '/repo/app' },
    ]);
  });

  it('keeps the Pi catalog paused while its managed runtime is missing', () => {
    runtimeMock.runtimes = { pi: { status: 'missing' } };

    renderHook(() => useAgentStartCatalogs('/repo/app'));

    expect(tayoriMock.params[3]).toBeNull();
  });

  it('requests the Pi catalog once its runtime is available', () => {
    runtimeMock.runtimes = { pi: { status: 'available', source: 'managed' } };

    renderHook(() => useAgentStartCatalogs('/repo/app'));

    expect(tayoriMock.params).toEqual([
      { agentKind: 'claude-code', cwd: '/repo/app' },
      { agentKind: 'codex', cwd: '/repo/app' },
      { agentKind: 'opencode', cwd: '/repo/app' },
      { agentKind: 'pi', cwd: '/repo/app' },
      { agentKind: 'grok-build', cwd: '/repo/app' },
    ]);
  });

  it('follows a workspace switch rather than capturing the first cwd', () => {
    runtimeMock.runtimes = { pi: { status: 'available', source: 'managed' } };
    const { rerender } = renderHook(({ cwd }: { cwd: string }) => useAgentStartCatalogs(cwd), {
      initialProps: { cwd: '/repo/app' },
    });
    tayoriMock.params.length = 0;
    rerender({ cwd: '/repo/other' });

    expect(tayoriMock.params).toEqual([
      { agentKind: 'claude-code', cwd: '/repo/other' },
      { agentKind: 'codex', cwd: '/repo/other' },
      { agentKind: 'opencode', cwd: '/repo/other' },
      { agentKind: 'pi', cwd: '/repo/other' },
      { agentKind: 'grok-build', cwd: '/repo/other' },
    ]);
  });
});
