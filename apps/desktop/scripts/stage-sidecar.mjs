#!/usr/bin/env node
/**
 * Build the PTY sidecar (crates/linkcode-pty) and stage it where electron-builder's
 * `extraResources: sidecar/${arch}` (electron-builder.yml) picks it up.
 *
 *   node scripts/stage-sidecar.mjs                              # host arch (local `package`)
 *   node scripts/stage-sidecar.mjs --target <triple> --arch <x64|arm64>   # cross build (CI)
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: { target: { type: 'string' }, arch: { type: 'string' } },
});
if ((values.target === undefined) !== (values.arch === undefined)) {
  throw new Error('--target and --arch must be passed together');
}
const arch = values.arch ?? process.arch;

const desktopDir = join(import.meta.dirname, '..');
const repoRoot = join(desktopDir, '..', '..');

const cargoArgs = ['build', '-p', 'linkcode-pty', '--release'];
if (values.target !== undefined) cargoArgs.push('--target', values.target);
execFileSync('cargo', cargoArgs, { cwd: repoRoot, stdio: 'inherit' });

const binary = process.platform === 'win32' ? 'linkcode-pty.exe' : 'linkcode-pty';
const built = join(
  repoRoot,
  'target',
  ...(values.target === undefined ? [] : [values.target]),
  'release',
  binary,
);
const destDir = join(desktopDir, 'sidecar', arch);
mkdirSync(destDir, { recursive: true });
cpSync(built, join(destDir, binary));
console.log(`staged ${built} -> ${join(destDir, binary)}`);
