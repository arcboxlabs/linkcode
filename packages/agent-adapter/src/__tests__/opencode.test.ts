import type { AgentEvent } from '@linkcode/schema';
import type { Event } from '@opencode-ai/sdk/v2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenCodeAdapter } from '../native/opencode';

const sdkMock = vi.hoisted(() => ({
  createOpencode: null as ((opts: unknown) => unknown) | null,
}));

vi.mock('@opencode-ai/sdk/v2', () => ({
  createOpencode(opts: unknown) {
    if (!sdkMock.createOpencode) throw new Error('createOpencode mock not installed');
    return sdkMock.createOpencode(opts);
  },
}));

/** Stands in for the SSE `ServerSentEventsResult['stream']` `event.subscribe()` resolves to: an
 * async-iterable queue tests push events into, mirroring the real for-await the adapter drains. */
class FakeEventStream {
  private readonly queued: Array<{ event: unknown } | { done: true } | { failed: unknown }> = [];
  private waiting: (() => void) | null = null;

  push(event: Event): void {
    this.queued.push({ event });
    this.flush();
  }
  /** A raw, possibly malformed payload — bypasses the `Event` shape `push()` requires, standing
   * in for a real SSE frame that doesn't match the SDK's declared types. */
  pushRaw(event: unknown): void {
    this.queued.push({ event });
    this.flush();
  }
  /** The server closing the stream on its own, without the adapter having stopped. */
  end(): void {
    this.queued.push({ done: true });
    this.flush();
  }
  /** The iterator itself failing (e.g. a dropped connection). */
  fail(err: unknown): void {
    this.queued.push({ failed: err });
    this.flush();
  }

  private flush(): void {
    const wake = this.waiting;
    this.waiting = null;
    wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Event> {
    while (true) {
      if (this.queued.length === 0) {
        await new Promise<void>((resolve) => {
          this.waiting = resolve;
        });
        continue;
      }
      const item = this.queued.shift()!;
      if ('done' in item) return;
      if ('failed' in item) throw item.failed;
      yield item.event as Event;
    }
  }
}

class FakeClient {
  readonly stream = new FakeEventStream();
  subscribeError: Error | null = null;
  readonly session = {
    create: vi.fn(() => ({ data: { id: 'sess-1' } })),
    prompt: vi.fn(() => ({})),
    abort: vi.fn(() => ({})),
  };
  readonly event = {
    subscribe: vi.fn(() => {
      if (this.subscribeError) throw this.subscribeError;
      return { stream: this.stream };
    }),
  };
}

const closeServer = vi.fn();
let client: FakeClient;

sdkMock.createOpencode = () => {
  client = new FakeClient();
  return Promise.resolve({ client, server: { url: 'http://fake', close: closeServer } });
};

afterEach(() => {
  closeServer.mockClear();
});

async function makeAdapter(): Promise<{ adapter: OpenCodeAdapter; events: AgentEvent[] }> {
  const adapter = new OpenCodeAdapter();
  const events: AgentEvent[] = [];
  adapter.onEvent((e) => events.push(e));
  await adapter.start({ kind: 'opencode', cwd: '/tmp/repo' });
  return { adapter, events };
}

function errors(events: AgentEvent[]): Array<Extract<AgentEvent, { type: 'error' }>> {
  return events.filter((e): e is Extract<AgentEvent, { type: 'error' }> => e.type === 'error');
}

describe('OpenCodeAdapter.consumeEvents', () => {
  it('reports a malformed event via emitError instead of throwing, and keeps consuming', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { events } = await makeAdapter();

      // `part` missing on a message.part.updated event — an unexpected shape handlePart cannot
      // handle; must not escape as an unhandled rejection or kill the stream.
      client.stream.pushRaw({
        id: 'e1',
        type: 'message.part.updated',
        properties: { sessionID: 'sess-1', time: 0 },
      });
      await vi.waitFor(() => {
        expect(errors(events)).toHaveLength(1);
      });

      // The stream keeps running afterwards: a well-formed event right after still gets through.
      client.stream.push({
        id: 'e2',
        type: 'message.part.updated',
        properties: {
          sessionID: 'sess-1',
          time: 0,
          part: { id: 'p1', sessionID: 'sess-1', messageID: 'msg-1', type: 'text', text: 'hi' },
        },
      });
      await vi.waitFor(() => {
        expect(events.some((e) => e.type === 'agent-message-chunk')).toBe(true);
      });

      await vi.waitFor(() => {
        expect(unhandled).not.toHaveBeenCalled();
      });
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('treats the stream ending on its own (no stop()) as a fatal, non-recoverable error', async () => {
    const { events } = await makeAdapter();
    events.length = 0;

    client.stream.end();

    await vi.waitFor(() => {
      expect(errors(events)).toHaveLength(1);
    });
    expect(errors(events)[0].recoverable).toBe(false);
    expect(events.some((e) => e.type === 'status' && e.status === 'idle')).toBe(true);
  });

  it('reports a subscribe() rejection without an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const adapter = new OpenCodeAdapter();
      const events: AgentEvent[] = [];
      adapter.onEvent((e) => events.push(e));

      sdkMock.createOpencode = () => {
        client = new FakeClient();
        client.subscribeError = new Error('beforeRequest hook rejected');
        return Promise.resolve({ client, server: { url: 'http://fake', close: closeServer } });
      };
      await adapter.start({ kind: 'opencode', cwd: '/tmp/repo' });

      await vi.waitFor(() => {
        expect(errors(events)).toHaveLength(1);
      });
      expect(errors(events)[0].message).toContain('beforeRequest hook rejected');
      expect(errors(events)[0].recoverable).toBe(false);

      await vi.waitFor(() => {
        expect(unhandled).not.toHaveBeenCalled();
      });
    } finally {
      process.off('unhandledRejection', unhandled);
      sdkMock.createOpencode = () => {
        client = new FakeClient();
        return Promise.resolve({ client, server: { url: 'http://fake', close: closeServer } });
      };
    }
  });

  it('on stop(): the stream ending afterwards is the expected shutdown, not an error', async () => {
    const { adapter, events } = await makeAdapter();
    await adapter.stop();
    events.length = 0;

    // stop() already closed the server; the stream ending is the normal fallout, not a failure.
    client.stream.end();
    await vi.waitFor(() => {
      // Give the loop a chance to run; nothing should ever land.
      expect(events).toHaveLength(0);
    });
  });
});
