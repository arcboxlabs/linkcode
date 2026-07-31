// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAgentStartCatalogs } from '../use-agent-catalogs';

const tayoriMock = vi.hoisted(() => ({ params: [] as unknown[] }));

vi.mock('../../runtime/tayori', () => ({
  useData(_operation: unknown, params: unknown) {
    tayoriMock.params.push(params);
    return { data: undefined };
  },
}));

afterEach(() => {
  tayoriMock.params.length = 0;
});

describe('useAgentStartCatalogs', () => {
  it('scopes every agent catalog request to the selected workspace', () => {
    renderHook(() => useAgentStartCatalogs('/repo/app'));

    // The cwd is what lets an adapter resolve the tier a session would really start under —
    // claude-code reads `permissions.defaultMode` from the workspace's own settings.
    expect(tayoriMock.params).toEqual([
      { agentKind: 'claude-code', cwd: '/repo/app' },
      { agentKind: 'codex', cwd: '/repo/app' },
      { agentKind: 'opencode', cwd: '/repo/app' },
      { agentKind: 'pi', cwd: '/repo/app' },
      { agentKind: 'grok-build', cwd: '/repo/app' },
    ]);
  });

  it('follows a workspace switch rather than capturing the first cwd', () => {
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
