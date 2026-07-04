import { daemonRuntimeFilePath, isPidAlive, readJsonFileSync } from '@linkcode/common/node';
import { DAEMON_DEFAULT_URL, DaemonRuntimeInfoSchema } from '@linkcode/schema';
import { getSettings } from './settings';

/**
 * Resolve the daemon endpoint the renderer should dial: the explicit settings override when
 * present, else the endpoint the running daemon advertises in `~/.linkcode/runtime.json`,
 * else the default port. Synchronous so it can serve the renderer's boot snapshot.
 */
export function resolveDaemonUrl(): string {
  return getSettings().daemonUrl ?? discoverRuntimeUrl() ?? DAEMON_DEFAULT_URL;
}

function discoverRuntimeUrl(): string | null {
  const file = daemonRuntimeFilePath();
  const parsed = DaemonRuntimeInfoSchema.safeParse(readJsonFileSync(file));
  if (!parsed.success || !isPidAlive(parsed.data.pid)) return null;
  // The renderer connects over Socket.IO; ignore listeners it cannot dial.
  const listener = parsed.data.listeners.find((entry) => entry.type === 'socket.io');
  return listener?.url ?? null;
}
