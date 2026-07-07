import childProcess from 'node:child_process';
import { existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';

/**
 * When the daemon runs inside Electron (bundled into the desktop app's asar), agent SDKs resolve
 * their vendored CLI binaries to paths inside `app.asar` and launch them with
 * `child_process.spawn`. Electron rewrites asar paths to their `app.asar.unpacked` copies for
 * `execFile`/`fork` only — a raw `spawn` hands the OS a path that traverses `app.asar` (a file)
 * as a directory and fails with ENOTDIR. electron-builder's smartUnpack already ships every such
 * binary unpacked, so extending Electron's substitution to `spawn` is all that's missing.
 */

const ASAR_SEGMENT = `${path.sep}app.asar${path.sep}`;
const UNPACKED_SEGMENT = `${path.sep}app.asar.unpacked${path.sep}`;

export function rewriteAsarSpawnPath(file: string): string {
  if (!file.includes(ASAR_SEGMENT)) return file;
  const unpacked = file.replace(ASAR_SEGMENT, UNPACKED_SEGMENT);
  return existsSync(unpacked) ? unpacked : file;
}

export function installAsarSpawnFix(): void {
  if (!process.versions.electron) return;
  // Loosely-typed alias of the original: the wrapper forwards every spawn overload
  // (args?, options?) untouched, and re-stating child_process's own signatures buys no safety.
  const spawn = childProcess.spawn.bind(childProcess) as (
    ...args: unknown[]
  ) => ReturnType<typeof childProcess.spawn>;
  childProcess.spawn = ((file: unknown, ...rest: unknown[]) =>
    spawn(
      typeof file === 'string' ? rewriteAsarSpawnPath(file) : file,
      ...rest,
    )) as typeof childProcess.spawn;
  // SDKs bind `import { spawn } from 'child_process'` as ESM named imports; propagate the patched
  // function onto the builtin's ESM facade.
  syncBuiltinESMExports();
}
