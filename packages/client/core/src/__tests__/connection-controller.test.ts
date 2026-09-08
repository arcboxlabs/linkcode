import type { Transport } from '@linkcode/transport';
import { noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import type { RecoverableClient } from '../connection-controller';
import { ConnectionController } from '../connection-controller';
import { WireIncompatibleError } from '../wire-incompatible-error';

/** The controller never drives the transport itself; the client it creates does. */
const transport: Transport = {
  connect: () => Promise.resolve(),
  send: noop,
  onMessage: () => noop,
  onClose: () => noop,
  close: noop,
};

class FailingClient implements RecoverableClient {
  constructor(private readonly failure: Error) {}

  connect(): Promise<void> {
    return Promise.reject(this.failure);
  }

  onClose(): () => void {
    return noop;
  }

  readonly dispose = noop;
}

const FAST_RETRY = { retries: 2, minTimeout: 1, maxTimeout: 1 };

describe('ConnectionController recovery', () => {
  it('stops at once when the handshake names a wire incompatibility', async () => {
    const createClient = vi.fn(
      () => new FailingClient(new WireIncompatibleError('update-app', 90, 85)),
    );
    const controller = new ConnectionController(
      { resolve: () => ({ transport }) },
      { createClient, retry: FAST_RETRY },
    );
    controller.start();

    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('error'));
    expect(controller.getSnapshot().error).toBeInstanceOf(WireIncompatibleError);
    expect(createClient).toHaveBeenCalledTimes(1);

    // A deliberate retry (the host may have been updated) dials once more and stops again.
    controller.retry();
    expect(controller.getSnapshot().status).toBe('connecting');
    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('error'));
    expect(controller.getSnapshot().error).toBeInstanceOf(WireIncompatibleError);
    expect(createClient).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('keeps retrying an ordinary connection failure until the budget runs out', async () => {
    const createClient = vi.fn(() => new FailingClient(new Error('connection refused')));
    const controller = new ConnectionController(
      { resolve: () => ({ transport }) },
      { createClient, retry: FAST_RETRY },
    );
    controller.start();

    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('error'));
    expect(controller.getSnapshot().error).toMatchObject({ message: 'connection refused' });
    expect(createClient).toHaveBeenCalledTimes(FAST_RETRY.retries + 1);
    controller.dispose();
  });
});
