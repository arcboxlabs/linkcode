import { nullthrow } from 'foxts/guard';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWireMessage } from '../transport';
import { WsTransport } from '../ws';

const CONNECTION_CLOSED = /connection closed/;

/** Minimal WebSocket stand-in the test drives by hand (open / message / drop). */
class FakeWebSocket {
  static readonly instances: FakeWebSocket[] = [];
  static get last(): FakeWebSocket {
    return nullthrow(this.instances.at(-1), 'no FakeWebSocket created');
  }

  readonly OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  private readonly listeners = new Map<string, Set<{ cb: (ev: unknown) => void; once: boolean }>>();

  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: (ev: unknown) => void, opts?: { once?: boolean }): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add({ cb, once: opts?.once ?? false });
    this.listeners.set(type, set);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.fire('close');
  }

  // Test controls.
  simulateOpen(): void {
    this.readyState = this.OPEN;
    this.fire('open');
  }
  simulateMessage(data: string): void {
    this.fire('message', { data });
  }
  simulateDrop(): void {
    this.readyState = 3;
    this.fire('close');
  }

  private fire(type: string, ev: unknown = {}): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const entry of set) {
      if (entry.once) set.delete(entry);
      entry.cb(ev);
    }
  }
}

const Impl = FakeWebSocket as unknown as typeof WebSocket;

/** Let `connect()`'s async `open()` reach `new WebSocket(...)` (it awaits the token first). */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  FakeWebSocket.instances.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('WsTransport handshake', () => {
  it('appends the token as access_token and offers the subprotocol', async () => {
    const transport = new WsTransport({
      url: 'wss://api.example.com/tunnel?role=client&host=h1',
      getToken: () => 'jwt-123',
      protocols: 'linkcode.tunnel.v1',
      WebSocketImpl: Impl,
    });
    const connected = transport.connect();
    await flush();

    const ws = FakeWebSocket.last;
    const url = new URL(ws.url);
    expect(url.searchParams.get('access_token')).toBe('jwt-123');
    expect(url.searchParams.get('role')).toBe('client');
    expect(ws.protocols).toBe('linkcode.tunnel.v1');

    ws.simulateOpen();
    await expect(connected).resolves.toBeUndefined();
  });

  it('delivers valid inbound wire messages and discards junk', async () => {
    const transport = new WsTransport({ url: 'wss://x/tunnel', WebSocketImpl: Impl });
    const received: unknown[] = [];
    transport.onMessage((msg) => received.push(msg));
    const connected = transport.connect();
    await flush();
    FakeWebSocket.last.simulateOpen();
    await connected;

    const message = createWireMessage({ kind: 'session.list', clientReqId: 'req-1' });
    FakeWebSocket.last.simulateMessage(JSON.stringify(message));
    FakeWebSocket.last.simulateMessage('not json');
    FakeWebSocket.last.simulateMessage(JSON.stringify({ nope: true }));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ payload: { kind: 'session.list', clientReqId: 'req-1' } });
  });

  it('rejects the initial connect on a pre-open drop and never auto-retries it', async () => {
    const transport = new WsTransport({
      url: 'wss://x/tunnel',
      reconnect: true,
      WebSocketImpl: Impl,
    });
    const onClose = vi.fn();
    transport.onClose(onClose);
    const connected = transport.connect();
    await flush();

    FakeWebSocket.last.simulateDrop();
    await expect(connected).rejects.toThrow(CONNECTION_CLOSED);
    expect(onClose).toHaveBeenCalledTimes(1);

    // The failed initial attempt schedules no reconnect.
    await vi.advanceTimersByTimeAsync(60000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('WsTransport reconnect', () => {
  it('closes on a dropped connection when reconnect is off (default)', async () => {
    const transport = new WsTransport({ url: 'wss://x/tunnel', WebSocketImpl: Impl });
    const onClose = vi.fn();
    transport.onClose(onClose);
    const connected = transport.connect();
    await flush();
    FakeWebSocket.last.simulateOpen();
    await connected;

    FakeWebSocket.last.simulateDrop();
    expect(onClose).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('reconnects an established drop without firing onClose, re-minting the token', async () => {
    let minted = 0;
    const transport = new WsTransport({
      url: 'wss://x/tunnel',
      getToken: () => `jwt-${++minted}`,
      reconnect: { baseMs: 500 },
      WebSocketImpl: Impl,
    });
    const onClose = vi.fn();
    transport.onClose(onClose);
    const connected = transport.connect();
    await flush();
    FakeWebSocket.last.simulateOpen();
    await connected;
    expect(new URL(FakeWebSocket.last.url).searchParams.get('access_token')).toBe('jwt-1');

    FakeWebSocket.last.simulateDrop();
    expect(onClose).not.toHaveBeenCalled();

    // Backoff hasn't elapsed yet — still one socket.
    await vi.advanceTimersByTimeAsync(400);
    expect(FakeWebSocket.instances).toHaveLength(1);

    // After the base delay a fresh socket opens with a freshly minted token.
    await vi.advanceTimersByTimeAsync(300);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(new URL(FakeWebSocket.last.url).searchParams.get('access_token')).toBe('jwt-2');
    FakeWebSocket.last.simulateOpen();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('grows the delay exponentially between attempts', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // strip jitter
    const transport = new WsTransport({
      url: 'wss://x/tunnel',
      reconnect: { baseMs: 100, factor: 2 },
      WebSocketImpl: Impl,
    });
    const connected = transport.connect();
    await flush();
    FakeWebSocket.last.simulateOpen();
    await connected;

    // drop #1 → retry after 100ms
    FakeWebSocket.last.simulateDrop();
    await vi.advanceTimersByTimeAsync(99);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    // drop #2 → retry after 200ms
    FakeWebSocket.last.simulateDrop();
    await vi.advanceTimersByTimeAsync(199);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(3);

    // drop #3 → retry after 400ms
    FakeWebSocket.last.simulateDrop();
    await vi.advanceTimersByTimeAsync(399);
    expect(FakeWebSocket.instances).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it('gives up with a terminal close once maxRetries is exhausted', async () => {
    const transport = new WsTransport({
      url: 'wss://x/tunnel',
      reconnect: { baseMs: 10, maxRetries: 2 },
      WebSocketImpl: Impl,
    });
    const onClose = vi.fn();
    transport.onClose(onClose);
    const connected = transport.connect();
    await flush();
    FakeWebSocket.last.simulateOpen();
    await connected;

    // Two reconnects are allowed; each fresh socket drops again before opening.
    for (let i = 0; i < 3; i++) {
      FakeWebSocket.last.simulateDrop();
      // eslint-disable-next-line no-await-in-loop -- timer advances must run in sequence
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(FakeWebSocket.instances).toHaveLength(3); // initial + 2 retries
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('close() fires onClose once and cancels a pending reconnect', async () => {
    const transport = new WsTransport({
      url: 'wss://x/tunnel',
      reconnect: { baseMs: 500 },
      WebSocketImpl: Impl,
    });
    const onClose = vi.fn();
    transport.onClose(onClose);
    const connected = transport.connect();
    await flush();
    FakeWebSocket.last.simulateOpen();
    await connected;

    FakeWebSocket.last.simulateDrop(); // schedules a reconnect
    transport.close();
    expect(onClose).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60000);
    expect(FakeWebSocket.instances).toHaveLength(1); // no reconnect after close
  });
});
