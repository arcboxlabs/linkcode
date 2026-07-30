import { LinkCodeClient, LinkCodeProvider } from '@linkcode/client-core';
import type { ValidatedWireMessage, WirePayload } from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { expect, vi } from 'vitest';

/** Drives a real `LinkCodeClient` so the assertions are on wire payloads, not on a faked client. */
export class ControlledTransport implements Transport {
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

/**
 * A client past its handshake, with `sent` cleared so a test sees only its own frames. The opening
 * `ping` has to be answered by hand: `connect()` rejects on the 5s timeout otherwise (Invariant 1).
 */
export async function connectClient(): Promise<{
  transport: ControlledTransport;
  client: LinkCodeClient;
}> {
  const transport = new ControlledTransport();
  const client = new LinkCodeClient(transport);
  const connecting = client.connect();
  await vi.waitFor(() => expect(transport.sent).toContainEqual({ kind: 'ping' }));
  transport.receive({ kind: 'pong' });
  await connecting;
  transport.sent.length = 0;
  return { transport, client };
}

/** The provider wrapper a `runtime/` hook reads its client from. */
export function clientWrapper(client: LinkCodeClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <LinkCodeProvider client={client}>{children}</LinkCodeProvider>
  );
}
