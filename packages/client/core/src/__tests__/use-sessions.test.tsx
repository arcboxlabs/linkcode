// @vitest-environment jsdom
import type { SessionId, SessionInfo, ValidatedWireMessage, WirePayload } from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { renderHook, waitFor } from '@testing-library/react';
import { noop } from 'foxact/noop';
import type * as React from 'react';
import { expect, it, vi } from 'vitest';
import { LinkCodeClient } from '../client';
import { LinkCodeProvider, useSessions } from '../react';

/** Answers `session.list` from a list the test can swap between assertions. */
class ListingTransport implements Transport {
  sessions: SessionInfo[] = [];
  listCalls = 0;
  readonly sent: WirePayload[] = [];
  private readonly messages = new Set<(message: ValidatedWireMessage) => void>();

  connect(): Promise<void> {
    return Promise.resolve();
  }

  send(message: ValidatedWireMessage): void {
    const payload = message.payload;
    this.sent.push(payload);
    if (payload.kind !== 'session.list') return;
    this.listCalls += 1;
    queueMicrotask(() =>
      this.receive({
        kind: 'session.listed',
        replyTo: payload.clientReqId,
        sessions: this.sessions,
      }),
    );
  }

  onMessage(cb: (message: ValidatedWireMessage) => void): Unsubscribe {
    this.messages.add(cb);
    return () => this.messages.delete(cb);
  }

  readonly close = noop;

  onClose(): Unsubscribe {
    return noop;
  }

  receive(payload: WirePayload): void {
    const message = createWireMessage(payload);
    for (const cb of this.messages) cb(message);
  }
}

function session(id: string, createdAt: number): SessionInfo {
  return {
    sessionId: id as SessionId,
    kind: 'claude-code',
    cwd: '/repo',
    status: 'idle',
    createdAt,
    updatedAt: createdAt,
  };
}

async function connectedHook(transport: ListingTransport) {
  const client = new LinkCodeClient(transport);
  const connecting = client.connect();
  // The pong only counts once the client is listening — it sends its ping from inside `connect`.
  await vi.waitFor(() => expect(transport.sent).toContainEqual({ kind: 'ping' }));
  transport.receive({ kind: 'pong' });
  await connecting;

  const wrapper = ({ children }: React.PropsWithChildren): React.ReactNode => (
    <LinkCodeProvider client={client}>{children}</LinkCodeProvider>
  );
  const hook = renderHook(() => useSessions(), { wrapper });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

it('picks up a session another client started', async () => {
  const transport = new ListingTransport();
  transport.sessions = [session('sess-a', 1)];
  const { result } = await connectedHook(transport);
  expect(result.current.sessions.map((s) => s.sessionId)).toEqual(['sess-a']);

  transport.sessions = [session('sess-a', 1), session('sess-b', 2)];
  transport.receive({
    kind: 'session.changed',
    sessionId: 'sess-b' as SessionId,
    reason: 'created',
  });

  await waitFor(() =>
    expect(result.current.sessions.map((s) => s.sessionId)).toEqual(['sess-a', 'sess-b']),
  );
});

it('drops a session another client closed', async () => {
  const transport = new ListingTransport();
  transport.sessions = [session('sess-a', 1)];
  const { result } = await connectedHook(transport);
  expect(result.current.sessions).toHaveLength(1);

  transport.sessions = [];
  transport.receive({
    kind: 'session.changed',
    sessionId: 'sess-a' as SessionId,
    reason: 'removed',
  });

  await waitFor(() => expect(result.current.sessions).toHaveLength(0));
});

it('coalesces a burst of changes into one refetch behind the one in flight', async () => {
  const transport = new ListingTransport();
  transport.sessions = [session('sess-a', 1)];
  const { result } = await connectedHook(transport);
  const afterSeed = transport.listCalls;

  transport.sessions = [session('sess-a', 1), session('sess-b', 2)];
  for (const reason of ['created', 'updated', 'updated'] as const) {
    transport.receive({ kind: 'session.changed', sessionId: 'sess-b' as SessionId, reason });
  }

  await waitFor(() => expect(result.current.sessions).toHaveLength(2));
  expect(transport.listCalls - afterSeed).toBeLessThanOrEqual(2);
});
