import { createClient } from '@linkcode/sdk';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { vi } from 'vitest';
import type { WorkbenchConnectionSource } from '../connection-controller';
import { WorkbenchConnectionController } from '../connection-controller';

export class TestTransport implements Transport {
  readonly close = vi.fn(() => {
    this.emitClose();
  });

  private readonly closeListeners = new Set<() => void>();

  constructor(readonly connect: () => Promise<void>) {}

  readonly send = noop;

  onMessage(): Unsubscribe {
    return noop;
  }

  onClose(cb: () => void): Unsubscribe {
    this.closeListeners.add(cb);
    return () => {
      this.closeListeners.delete(cb);
    };
  }

  emitClose(): void {
    for (const listener of this.closeListeners) listener();
  }
}

export function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolveDeferred!: () => void;
  let rejectDeferred!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });
  return { promise, resolve: resolveDeferred, reject: rejectDeferred };
}

export function transportSequence(...transports: TestTransport[]): () => TestTransport {
  let index = 0;
  return () => {
    const transport = nullthrow(transports.at(index), 'test transport sequence exhausted');
    index += 1;
    return transport;
  };
}

export function testController(
  source: WorkbenchConnectionSource,
  retry: { minTimeout?: number; maxTimeout?: number; factor?: number } = {},
): WorkbenchConnectionController {
  return new WorkbenchConnectionController(source, {
    createClient(transport) {
      const client = createClient({ transport });
      vi.spyOn(client, 'connect').mockImplementation(() => transport.connect());
      vi.spyOn(client, 'onClose').mockImplementation((cb) =>
        transport.onClose(() => cb(new Error('closed'))),
      );
      return client;
    },
    retry,
  });
}
