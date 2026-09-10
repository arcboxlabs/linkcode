// @vitest-environment jsdom
import { LinkCodeClient, useLinkCodeClient } from '@linkcode/client-core';
import { listSessions, listWorkspaces } from '@linkcode/sdk';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { createFixedArray } from 'foxts/create-fixed-array';
import { nullthrow } from 'foxts/guard';
import { asyncNoop } from 'foxts/noop';
import { wait } from 'foxts/wait';
import { afterEach, expect, it, vi } from 'vitest';
import { createDevMockTransport } from '../../src/mock/dev-mock-transport';
import {
  deferred,
  TestTransport,
} from '../../src/runtime/__tests__/connection-controller-test-helpers';
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

function useLazySidebarInputs() {
  const { data: workspaces } = useData(listWorkspaces, () => ({}));
  const { data: sessions } = useData(listSessions, () => ({}));
  return { client: useLinkCodeClient(), workspaces, sessions };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The mock host answers every control request after a scripted latency; each step here is one or
// more of those round trips.
const STEP_TIMEOUT = { timeout: 4000 };

it.each([
  { keyForm: 'object', useInputs: useSidebarInputs },
  { keyForm: 'lazy', useInputs: useLazySidebarInputs },
])(
  'refreshes $keyForm keys when another client starts a session',
  async ({ useInputs }) => {
    const { result } = renderHook(useInputs, { wrapper: Runtime });
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
  },
  15000,
);

it('collapses a burst of pushes instead of one round trip per frame', async () => {
  const listSpy = vi.spyOn(LinkCodeClient.prototype, 'listSessions');
  const workspaceSpy = vi.spyOn(LinkCodeClient.prototype, 'listWorkspaces');
  const { result } = renderHook(useSidebarInputs, { wrapper: Runtime });
  await waitFor(() => expect(result.current.workspaces).toBeDefined(), STEP_TIMEOUT);

  const starts = 6;
  listSpy.mockClear();
  workspaceSpy.mockClear();
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
    const workspaces = result.current.workspaces?.map((workspace) => workspace.cwd) ?? [];
    for (let i = 0, len = ids.length; i < len; i++) {
      expect(listed).toContain(ids[i]);
      expect(workspaces).toContain(`/mock/elsewhere/burst-${i}`);
    }
  }, STEP_TIMEOUT);

  // All starts complete within the mock's list latency: one in-flight fetch plus one trailing.
  expect(listSpy.mock.calls.length).toBeLessThanOrEqual(2);
  expect(workspaceSpy.mock.calls.length).toBeLessThanOrEqual(2);
}, 15000);

it('restores an archived workspace before announcing a resumed session', async () => {
  const { result } = renderHook(useSidebarInputs, { wrapper: Runtime });
  await waitFor(() => {
    expect(result.current.sessions).toBeDefined();
    expect(result.current.workspaces).toBeDefined();
  }, STEP_TIMEOUT);
  const { client } = result.current;
  const session = nullthrow(result.current.sessions?.find((item) => item.status === 'stopped'));
  const workspace = nullthrow(result.current.workspaces?.find((item) => item.cwd === session.cwd));
  await client.archiveWorkspace(workspace.workspaceId);
  expect((await client.listWorkspaces()).map((item) => item.cwd)).not.toContain(session.cwd);

  await client.resumeSession(session.sessionId);

  await waitFor(() => {
    const restored = result.current.workspaces?.find((item) => item.cwd === session.cwd);
    expect(restored).toBeDefined();
    expect(restored?.lastUsedAt).toBeGreaterThan(workspace.lastUsedAt);
  }, STEP_TIMEOUT);
}, 15000);

it('does not drain queued refreshes through a disposed generation during recovery', async () => {
  const transport = createDevMockTransport();
  vi.spyOn(connectionSource, 'resolve')
    .mockReturnValueOnce({ endpoint: 'mock://session-changed', transport })
    .mockReturnValue({
      endpoint: 'mock://session-changed',
      transport: new TestTransport(asyncNoop),
    });
  const { result } = renderHook(useSidebarInputs, { wrapper: Runtime });
  await waitFor(() => expect(result.current.workspaces).toBeDefined(), STEP_TIMEOUT);
  const { client } = result.current;
  const pending = deferred();
  const pendingSessions = deferred();
  const workspaceSpy = vi
    .spyOn(client, 'listWorkspaces')
    .mockImplementationOnce(() => pending.promise.then(() => []));
  const sessionSpy = vi
    .spyOn(client, 'listSessions')
    .mockImplementationOnce(() => pendingSessions.promise.then(() => []));

  await Promise.all([
    client.startSession({ kind: 'claude-code', cwd: '/mock/recovery-one' }),
    client.startSession({ kind: 'claude-code', cwd: '/mock/recovery-two' }),
  ]);
  expect(workspaceSpy).toHaveBeenCalledTimes(1);
  expect(sessionSpy).toHaveBeenCalledTimes(1);
  transport.close();
  pending.resolve();
  pendingSessions.resolve();
  await wait(0);

  expect(workspaceSpy).toHaveBeenCalledTimes(1);
  expect(sessionSpy).toHaveBeenCalledTimes(1);
}, 15000);
