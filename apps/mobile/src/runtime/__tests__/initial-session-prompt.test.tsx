// @vitest-environment jsdom
import type { SessionId } from '@linkcode/schema';
import { queueInitialSessionPrompt } from '@mobile/runtime/initial-session-prompt';
import { useSeededConversation } from '@mobile/runtime/use-seeded-conversation';
import { useSessionActions } from '@mobile/runtime/use-session-actions';
import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { expect, it } from 'vitest';
import { clientWrapper, connectClient } from './client-test-helpers';

const SESSION = 'session-1' as SessionId;

it('attaches before sending once, preserves a rejected draft, and retries the same session', async () => {
  const { client, transport } = await connectClient();
  queueInitialSessionPrompt(client, SESSION, 'Create a calculator');
  const Provider = clientWrapper(client);
  const view = renderHook(
    () => {
      useSeededConversation(SESSION, null);
      return useSessionActions(SESSION, 'idle');
    },
    {
      wrapper: ({ children }) => (
        <StrictMode>
          <Provider>{children}</Provider>
        </StrictMode>
      ),
    },
  );

  await waitFor(() =>
    expect(transport.sent.some((frame) => frame.kind === 'agent.input')).toBe(true),
  );
  const inputs = transport.sent.filter((frame) => frame.kind === 'agent.input');
  expect(inputs).toHaveLength(1);
  expect(transport.sent[0]).toEqual({ kind: 'session.attach', sessionId: SESSION });
  expect(inputs[0].input).toEqual({
    type: 'prompt',
    content: [{ type: 'text', text: 'Create a calculator' }],
  });

  act(() =>
    transport.receive({
      kind: 'request.failed',
      replyTo: inputs[0].clientReqId,
      message: 'Rejected',
    }),
  );
  await waitFor(() => expect(view.result.current.failure).toBe('send'));
  expect(view.result.current.text).toBe('Create a calculator');
  expect(view.result.current.sending).toBe(false);

  act(() => view.result.current.send(view.result.current.text));
  const retry = transport.sent.filter((frame) => frame.kind === 'agent.input')[1];
  expect(retry.sessionId).toBe(SESSION);
  expect(transport.sent.some((frame) => frame.kind === 'session.start')).toBe(false);
  act(() => transport.receive({ kind: 'request.succeeded', replyTo: retry.clientReqId }));
  await waitFor(() => expect(view.result.current.text).toBe(''));
  expect(view.result.current.failure).toBeNull();
  view.unmount();
  client.dispose();
});

it('does not clear text edited while the previous send is awaiting acknowledgment', async () => {
  const { client, transport } = await connectClient();
  const view = renderHook(() => useSessionActions(SESSION, 'idle'), {
    wrapper: clientWrapper(client),
  });
  act(() => view.result.current.setText('First draft'));
  act(() => view.result.current.send('First draft'));
  const input = transport.sent.find((frame) => frame.kind === 'agent.input');
  expect(input).toBeDefined();
  act(() => {
    view.result.current.setText('Next draft');
    transport.receive({ kind: 'request.succeeded', replyTo: input!.clientReqId });
  });
  await waitFor(() => expect(view.result.current.sending).toBe(false));
  expect(view.result.current.text).toBe('Next draft');
  view.unmount();
  client.dispose();
});
