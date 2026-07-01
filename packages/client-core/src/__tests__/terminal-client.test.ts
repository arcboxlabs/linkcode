import type { Transport } from '@linkcode/transport';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import { LinkCodeClient } from '../client';

/** A transport whose every `send` rejects, so terminal frames always fail to leave. */
function sendFailingTransport(err: Error): Transport {
  return {
    connect() {
      return Promise.resolve();
    },
    send() {
      return Promise.reject(err);
    },
    onMessage: () => noop,
    onClose: () => noop,
    close: noop,
  };
}

// Let the rejected send promise's `.catch` handler run.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('LinkCodeClient terminal error channel', () => {
  it('routes a failed terminal send to that terminal, and only that terminal', async () => {
    const client = new LinkCodeClient(sendFailingTransport(new Error('socket closed')));
    await client.connect();

    const errorsA: Error[] = [];
    const errorsB: Error[] = [];
    client.subscribeTerminalError('term-a', (err) => errorsA.push(err));
    client.subscribeTerminalError('term-b', (err) => errorsB.push(err));

    client.terminalInput('term-a', 'ls\n');
    await flushMicrotasks();

    expect(errorsA).toHaveLength(1);
    expect(errorsA[0]?.message).toContain('socket closed');
    expect(errorsB).toHaveLength(0);

    client.dispose();
  });

  it('stops delivering errors after unsubscribe', async () => {
    const client = new LinkCodeClient(sendFailingTransport(new Error('socket closed')));
    await client.connect();

    const errors: Error[] = [];
    const unsubscribe = client.subscribeTerminalError('term-a', (err) => errors.push(err));
    unsubscribe();

    client.terminalInput('term-a', 'ls\n');
    await flushMicrotasks();

    expect(errors).toHaveLength(0);

    client.dispose();
  });
});
