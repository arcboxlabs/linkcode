// @vitest-environment jsdom
import { LinkCodeClient, useLinkCodeClient } from '@linkcode/client-core';
import { listSessions } from '@linkcode/sdk';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { createFixedArray } from 'foxts/create-fixed-array';
import { afterEach, expect, it, vi } from 'vitest';
import { createDevMockTransport } from '../../src/mock/dev-mock-transport';
import { DebugProvider } from '../../src/runtime/debug';
import { WorkbenchRuntimeProvider } from '../../src/runtime/provider';
import { useData } from '../../src/runtime/tayori';
import { useWorkspaces } from '../../src/workspace/hooks';

const connectionSource = {
  resolve: () => ({ endpoint: 'mock://session-changed', transport: createDevMockTransport() }),
};

function Runtime({ children }: React.PropsWithChildren): React.ReactNode {
  return (
    <DebugProvider>
      <WorkbenchRuntimeProvider connectionSource={connectionSource}>
        {children}
      </WorkbenchRuntimeProvider>
    </DebugProvider>
  );
}

/** The sidebar's two inputs, read the way the workbench reads them — through the shared hooks,
 * which never call `mutate()` themselves. */
function useSidebarInputs() {
  const { data: workspaces } = useWorkspaces();
  const { data: sessions } = useData(listSessions, {});
  return { client: useLinkCodeClient(), workspaces, sessions };
}

afterEach(cleanup);

// The mock host answers every control request after a scripted latency; each step here is one or
// more of those round trips.
const STEP_TIMEOUT = { timeout: 4000 };

it('lists the workspace another client created by starting a session in it', async () => {
  const { result } = renderHook(useSidebarInputs, { wrapper: Runtime });
  await waitFor(() => expect(result.current.workspaces).toBeDefined(), STEP_TIMEOUT);
  const cwd = '/mock/elsewhere/new-repo';
  expect(result.current.workspaces?.map((workspace) => workspace.cwd)).not.toContain(cwd);

  // Bypassing the workbench's own create path stands in for another client: this client only
  // learns about the session from the host's pushed frames.
  const sessionId = await result.current.client.startSession({ kind: 'claude-code', cwd });

  await waitFor(() => {
    expect(result.current.workspaces?.map((workspace) => workspace.cwd)).toContain(cwd);
    expect(result.current.sessions?.map((session) => session.sessionId)).toContain(sessionId);
  }, STEP_TIMEOUT);
}, 15000);

it('collapses a burst of pushes instead of one round trip per frame', async () => {
  const listSpy = vi.spyOn(LinkCodeClient.prototype, 'listSessions');
  const { result } = renderHook(useSidebarInputs, { wrapper: Runtime });
  await waitFor(() => expect(result.current.workspaces).toBeDefined(), STEP_TIMEOUT);

  const starts = 6;
  listSpy.mockClear();
  const ids = await Promise.all(
    createFixedArray(starts).map((index) =>
      result.current.client.startSession({
        kind: 'claude-code',
        cwd: `/mock/elsewhere/burst-${index}`,
      }),
    ),
  );

  await waitFor(() => {
    const listed = result.current.sessions?.map((session) => session.sessionId) ?? [];
    for (let i = 0, len = ids.length; i < len; i++) expect(listed).toContain(ids[i]);
  }, STEP_TIMEOUT);

  // Uncoalesced this is 1:1 with the frames (the engine emits several per start, and SWR's
  // key-filter mutate deletes its own dedupe markers), so the ceiling is the guard.
  expect(listSpy.mock.calls.length).toBeLessThan(starts);
  listSpy.mockRestore();
}, 15000);
