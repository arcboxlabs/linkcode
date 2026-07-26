// @vitest-environment jsdom
import { LinkCodeClient, LinkCodeProvider } from '@linkcode/client-core';
import type { SessionId, ValidatedWireMessage, WirePayload } from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useSessionActions } from '../use-session-actions';

/** Drives a real `LinkCodeClient` so the assertions are on wire payloads, not on a faked client. */
class ControlledTransport implements Transport {
  readonly sent: WirePayload[] = [];
  private readonly messages = new Set<(message: ValidatedWireMessage) => void>();
  private readonly closes = new Set<() => void>();

  connect(): Promise<void> {
    return Promise.resolve();
  }

  send(message: ValidatedWireMessage): void {
    this.sent.push(message.payload);
  }

  onMessage(cb: (message: ValidatedWireMessage) => void): Unsubscribe {
    this.messages.add(cb);
    return () => this.messages.delete(cb);
  }

  onClose(cb: () => void): Unsubscribe {
    this.closes.add(cb);
    return () => this.closes.delete(cb);
  }

  close(): void {
    for (const cb of this.closes) cb();
  }

  receive(payload: WirePayload): void {
    const message = createWireMessage(payload);
    for (const cb of this.messages) cb(message);
  }
}

const SESSION = 'session-1' as SessionId;

/** Connected client + the provider wrapper the hook reads its client from. */
async function mountActions(sessionId: SessionId | null, status: 'idle' | 'running' | 'stopped') {
  const transport = new ControlledTransport();
  const client = new LinkCodeClient(transport);
  const connecting = client.connect();
  await vi.waitFor(() => expect(transport.sent).toContainEqual({ kind: 'ping' }));
  transport.receive({ kind: 'pong' });
  await connecting;
  transport.sent.length = 0;

  const view = renderHook(() => useSessionActions(sessionId, status), {
    wrapper: ({ children }) => <LinkCodeProvider client={client}>{children}</LinkCodeProvider>,
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
