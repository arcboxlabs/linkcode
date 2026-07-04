/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DAEMON_RUNTIME_FILE_SEGMENTS } from '@linkcode/schema/daemon-runtime-constants';

/**
 * Node-only utilities, exposed via the `@linkcode/common/node` subpath so they never
 * reach browser or React Native bundles. The tsconfig base sets `types: []`, so the
 * reference above opts this one module into the Node globals.
 */

/** Parse a JSON file, or `null` when it is missing, unreadable, or malformed. */
export function readJsonFileSync(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Whether a process with this pid exists (signal 0 probe). */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to someone else — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Path of the daemon's runtime discovery file under the user's home directory. */
export function daemonRuntimeFilePath(): string {
  return join(homedir(), ...DAEMON_RUNTIME_FILE_SEGMENTS);
}
