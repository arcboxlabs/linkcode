import { Socket } from 'node:net';
import { Effect } from 'effect';

const HEALTH_PROBE_TIMEOUT_MS = 500;

export function probeTcp(port: number): Effect.Effect<boolean> {
  return Effect.callback<boolean>((resume) => {
    const socket = new Socket();
    socket.setTimeout(HEALTH_PROBE_TIMEOUT_MS);
    let settled = false;
    function cleanup(): void {
      socket.off('connect', onConnect);
      socket.off('timeout', onTimeout);
      socket.off('error', onError);
      socket.destroy();
    }
    function done(ok: boolean): void {
      if (settled) return;
      settled = true;
      cleanup();
      resume(Effect.succeed(ok));
    }
    function onConnect(): void {
      done(true);
    }
    function onTimeout(): void {
      done(false);
    }
    function onError(): void {
      done(false);
    }
    socket.once('connect', onConnect);
    socket.once('timeout', onTimeout);
    socket.once('error', onError);
    try {
      socket.connect(port, '127.0.0.1');
    } catch {
      done(false);
    }
    return Effect.sync(() => {
      if (settled) return;
      settled = true;
      cleanup();
    });
  });
}
