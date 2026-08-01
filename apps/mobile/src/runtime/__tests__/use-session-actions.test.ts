// @vitest-environment jsdom
import type { SessionId } from '@linkcode/schema';
import { useSessionActions } from '@mobile/runtime/use-session-actions';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { clientWrapper, connectClient } from './client-test-helpers';

const SESSION = 'session-1' as SessionId;

/** Connected client + the provider wrapper the hook reads its client from. */
async function mountActions(sessionId: SessionId | null, status: 'idle' | 'running' | 'stopped') {
  const { transport, client } = await connectClient();
  const view = renderHook(() => useSessionActions(sessionId, status), {
    wrapper: clientWrapper(client),
  });
  return { transport, client, view };
}

it('sends the draft as a text prompt for the session', async () => {
  const { transport, client, view } = await mountActions(SESSION, 'idle');

  act(() => view.result.current.send('Create a calculator'));

  await waitFor(() =>
    expect(transport.sent).toContainEqual(
      expect.objectContaining({
        kind: 'agent.input',
        sessionId: SESSION,
        input: { type: 'prompt', content: [{ type: 'text', text: 'Create a calculator' }] },
      }),
    ),
  );
  client.dispose();
});

it('cancels the running turn', async () => {
  const { transport, client, view } = await mountActions(SESSION, 'running');

  expect(view.result.current.isRunning).toBe(true);
  act(() => view.result.current.stop());

  await waitFor(() =>
    expect(transport.sent).toContainEqual(
      expect.objectContaining({
        kind: 'agent.input',
        sessionId: SESSION,
        input: { type: 'cancel' },
      }),
    ),
  );
  client.dispose();
});

it('is not composable without a live session, and sends nothing', async () => {
  const { transport, client, view } = await mountActions(null, 'idle');

  expect(view.result.current.canCompose).toBe(false);
  act(() => view.result.current.send('ignored'));

  expect(transport.sent).toHaveLength(0);
  client.dispose();
});

it('treats a stopped thread as not composable', async () => {
  const { client, view } = await mountActions(SESSION, 'stopped');

  expect(view.result.current.canCompose).toBe(false);
  expect(view.result.current.isRunning).toBe(false);
  client.dispose();
});
