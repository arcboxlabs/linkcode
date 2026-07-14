/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { daemonRuntimeFileSegments } from '@linkcode/schema/daemon-runtime-constants';

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
export function daemonRuntimeFilePath(profile?: string): string {
  return join(homedir(), ...daemonRuntimeFileSegments(profile));
}

/** Ask the OS for a free loopback port: bind 0, read it back, close. Check-then-use — the port
 * can be taken between this probe and the consumer's own bind; callers that hand it to another
 * process must treat a bind failure as retryable. */
export function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('port allocation returned no address'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}
