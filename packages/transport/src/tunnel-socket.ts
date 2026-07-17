import type { TunnelRole } from '@linkcode/tunnel';
import { TUNNEL_PATH } from '@linkcode/tunnel';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { noop } from 'foxts/noop';
import {
  TUNNEL_HOST_HANDOFF_ACK_FRAME,
  TUNNEL_HOST_PREPARED_FRAME,
  TUNNEL_HOST_READY_ACK_FRAME,
  TUNNEL_HOST_READY_FRAME,
  TUNNEL_HOST_ROTATE_PREFIX,
  TUNNEL_SUBPROTOCOL,
} from './tunnel-protocol';

const HANDSHAKE_TIMEOUT_MS = 10000;

export interface TunnelSocketOptions {
  baseUrl: string;
  role: TunnelRole;
  hostId: string;
  name?: string;
  getToken: () => Promise<string>;
  signToken?: (accessToken: string) => string | Promise<string>;
  WebSocketImpl?: typeof WebSocket;
}

export interface PreparedTunnelSocket {
  readonly buffered: MessageEvent[];
  readonly status: 'active' | 'prepared';
  readonly active: Promise<void>;
  release(): Error | null;
}

export class TunnelAuthError extends Error {
  override name = 'TunnelAuthError';
}

export class TunnelSocketCloseError extends Error {
  override name = 'TunnelSocketCloseError';

  constructor(readonly code: number) {
    super('TunnelClient: socket closed during handshake');
  }
}

export async function dialTunnelSocket(opts: TunnelSocketOptions): Promise<WebSocket> {
  let token: string;
  try {
    token = await opts.getToken();
  } catch (error) {
    throw new TunnelAuthError(`TunnelClient: token refresh failed: ${extractErrorMessage(error)}`);
  }
  const url = new URL(TUNNEL_PATH, opts.baseUrl.replace(/^http/, 'ws'));
  url.searchParams.set('access_token', token);
  url.searchParams.set('role', opts.role);
  url.searchParams.set('host', opts.hostId);
  if (opts.signToken) url.searchParams.set('proof', await opts.signToken(token));
  if (opts.role === 'host' && opts.name) url.searchParams.set('name', opts.name);
  const Impl = opts.WebSocketImpl ?? Reflect.get(globalThis, 'WebSocket');
  if (!Impl) throw new Error('TunnelClient: no WebSocket implementation available');
  const ws = new Impl(url.href, [TUNNEL_SUBPROTOCOL]);
  ws.binaryType = 'arraybuffer';
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('TunnelClient: connection error')), {
      once: true,
    });
  });
  return ws;
}

export function prepareTunnelSocket(
  ws: WebSocket,
  role: TunnelRole,
  rotation?: string,
): Promise<PreparedTunnelSocket> {
  if (role !== 'host') {
    return Promise.resolve({
      buffered: [],
      status: 'active',
      active: Promise.resolve(),
      release: () => null,
    });
  }
  const { promise: active, resolve: resolveActive, reject: rejectActive } = createSignal();
  return new Promise((resolve, reject) => {
    const buffered: MessageEvent[] = [];
    let settled = false;
    let released = false;
    let failure: Error | null = null;
    const timer = setTimeout(() => {
      const error = new Error('TunnelClient: host handshake timed out');
      if (!settled) reject(error);
      else rejectActive(error);
    }, HANDSHAKE_TIMEOUT_MS);
    const settle = (status: PreparedTunnelSocket['status']): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        buffered,
        status,
        active,
        release() {
          released = true;
          clearTimeout(timer);
          return failure;
        },
      });
    };
    ws.addEventListener('message', (event: MessageEvent) => {
      if (released) return;
      if (event.data === TUNNEL_HOST_READY_ACK_FRAME) {
        resolveActive();
        settle('active');
        return;
      }
      if (event.data === TUNNEL_HOST_PREPARED_FRAME) {
        settle('prepared');
        return;
      }
      buffered.push(event);
    });
    ws.addEventListener('close', (event: CloseEvent) => {
      if (released) return;
      const error = new TunnelSocketCloseError(event.code);
      failure ??= error;
      if (!settled) reject(error);
      else rejectActive(error);
    });
    ws.addEventListener('error', () => {
      if (released) return;
      const error = new Error('TunnelClient: connection error during handshake');
      failure ??= error;
      if (!settled) reject(error);
      else rejectActive(error);
    });
    ws.send(rotation ? `${TUNNEL_HOST_ROTATE_PREFIX}${rotation}` : TUNNEL_HOST_READY_FRAME);
  });
}

export function rotationToken(): string {
  const crypto = globalThis.crypto;
  if (!crypto?.randomUUID) throw new Error('TunnelClient: crypto.randomUUID is unavailable');
  return crypto.randomUUID();
}

export function waitForHandoffDrain(ws: WebSocket): Promise<boolean> {
  const drained = new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (acknowledged: boolean): void => {
      if (done) return;
      done = true;
      resolve(acknowledged);
    };
    ws.addEventListener('message', (event: MessageEvent) => {
      if (event.data === TUNNEL_HOST_HANDOFF_ACK_FRAME) finish(true);
    });
    // A close event is ordered after every message already delivered on the old socket.
    ws.addEventListener('close', () => finish(false), { once: true });
  });
  return withTunnelTimeout(drained, 'TunnelClient: old host drain timed out');
}

export function withTunnelTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), HANDSHAKE_TIMEOUT_MS);
    void (async () => {
      try {
        const value = await promise;
        clearTimeout(timer);
        resolve(value);
      } catch (error) {
        clearTimeout(timer);
        reject(new Error(extractErrorMessage(error) ?? message, { cause: error }));
      }
    })();
  });
}

function createSignal(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolveSignal = noop;
  let rejectSignal: (error: Error) => void = noop;
  const promise = new Promise<void>((resolve, reject) => {
    resolveSignal = resolve;
    rejectSignal = reject;
  });
  return { promise, resolve: resolveSignal, reject: rejectSignal };
}
