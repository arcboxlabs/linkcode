import childProcess from 'node:child_process';
import { existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';

/**
 * Electron rewrites `app.asar` paths to `app.asar.unpacked` for `execFile`/`fork` but not raw
 * `spawn`, so agent SDKs spawning vendored binaries from inside the asar fail with ENOTDIR.
 * Extend the substitution to `spawn` (smartUnpack already ships the binaries unpacked).
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
