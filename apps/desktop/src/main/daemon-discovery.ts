import { mkdirSync, watch } from 'node:fs';
import { basename, dirname } from 'node:path';
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

/** Debounce window for runtime-file events: a write lands as several fs events in a burst. */
const RUNTIME_WATCH_DEBOUNCE_MS = 100;

/**
 * Watch the daemon runtime file and fire `onChange` (debounced) when a daemon (re)starts or
 * stops. Watches the parent directory: the file itself is created/removed across daemon
 * lifetimes, and a watcher pinned to a deleted inode goes blind.
 */
export function watchDaemonRuntime(onChange: () => void): () => void {
  const file = daemonRuntimeFilePath();
  // The daemon creates ~/.linkcode on first start; create it up front so watching never races that.
  mkdirSync(dirname(file), { recursive: true });
  let debounce: NodeJS.Timeout | null = null;
  const watcher = watch(dirname(file), (_event, filename) => {
    if (filename !== basename(file)) return;
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      onChange();
    }, RUNTIME_WATCH_DEBOUNCE_MS);
  });
  return () => {
    if (debounce !== null) clearTimeout(debounce);
    watcher.close();
  };
}
