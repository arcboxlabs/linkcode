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
        // eslint-disable-next-line no-await-in-loop -- queue iterator: the await IS the next-event signal
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

  it('treats the stream ending after the turn already went idle as expected, not an error', async () => {
    const { adapter, events } = await makeAdapter();

    await adapter.send({ type: 'prompt', content: [] });
    client.stream.push({
      id: 'e-idle',
      type: 'session.idle',
      properties: { sessionID: 'sess-1' },
    });
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'status' && e.status === 'idle')).toBe(true);
    });
    events.length = 0;

    // opencode closing the SSE stream right after the turn ended is the normal fallout of a
    // completed round-trip, not a failure — there's nothing left to interrupt.
    client.stream.end();

    await vi.waitFor(() => {
      // Give the loop a chance to run; nothing should ever land.
      expect(events).toHaveLength(0);
    });
  });

  it('treats the stream closing while a turn is still active as a fatal error and stops the session', async () => {
    const { adapter, events } = await makeAdapter();
    events.length = 0;

    await adapter.send({ type: 'prompt', content: [] });
    events.length = 0;

    // The stream closes mid-turn — before `session.idle` — so the in-flight round-trip can no
    // longer receive completion signals.
    client.stream.end();

    await vi.waitFor(() => {
      expect(errors(events)).toHaveLength(1);
    });
    expect(errors(events)[0].recoverable).toBe(false);
    // `stopped`, not `idle` — the shell only disables the composer on `stopped`, and a session that
    // can no longer receive events must not look usable.
    expect(events.some((e) => e.type === 'status' && e.status === 'stopped')).toBe(true);
    expect(events.some((e) => e.type === 'status' && e.status === 'idle')).toBe(false);
  });

  it('treats a cancel-triggered stream close as the expected fallout of the abort, not an error', async () => {
    const { adapter, events } = await makeAdapter();

    await adapter.send({ type: 'prompt', content: [] });
    events.length = 0;

    await adapter.send({ type: 'cancel' });
    expect(client.session.abort).toHaveBeenCalledWith({ sessionID: 'sess-1' });

    // Cancel aborts the turn without a matching `session.idle`; opencode then closes the stream —
    // that's the abort's own fallout, not an unexpected disconnect.
    client.stream.end();

    await vi.waitFor(() => {
      // Give the loop a chance to run; nothing should ever land.
      expect(events).toHaveLength(0);
    });
  });

  it('does not latch the cancel suppression when abort() itself rejects, so a later stream failure still surfaces', async () => {
    const { adapter, events } = await makeAdapter();

    await adapter.send({ type: 'prompt', content: [] });
    events.length = 0;

    // The abort request fails: the turn was never actually cancelled, so no cancel-induced close
    // is coming. `send('cancel')` rejects — the caller sees the failure directly.
    client.session.abort.mockRejectedValueOnce(new Error('abort failed'));
    await expect(adapter.send({ type: 'cancel' })).rejects.toThrow('abort failed');

    // A genuine disconnect afterwards must NOT be swallowed as an expected cancel close.
    client.stream.fail(new Error('connection dropped'));

    await vi.waitFor(() => {
      expect(errors(events)).toHaveLength(1);
    });
    expect(errors(events)[0].recoverable).toBe(false);
    expect(events.some((e) => e.type === 'status' && e.status === 'stopped')).toBe(true);
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
      expect(events.some((e) => e.type === 'status' && e.status === 'stopped')).toBe(true);

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
