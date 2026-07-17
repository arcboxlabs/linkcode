#!/usr/bin/env node
/**
 * Build the PTY sidecar (crates/linkcode-pty) and stage it where electron-builder's
 * `extraResources: sidecar/${arch}` (electron-builder.yml) picks it up. Default = host arch
 * (local `package`); `--all` adds the cross arch (CI, .github/actions/build-sidecar).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

interface CrossBuild {
  target: string;
  arch: NodeJS.Architecture;
  env?: Record<string, string>;
}

/** The non-native arch each release platform also ships. Toolchain targets and the linux cross
 * linker are installed by .github/actions/build-sidecar. */
const CROSS_BUILDS: Partial<Record<NodeJS.Platform, CrossBuild>> = {
  darwin: { target: 'x86_64-apple-darwin', arch: 'x64' },
  win32: { target: 'aarch64-pc-windows-msvc', arch: 'arm64' },
  linux: {
    target: 'aarch64-unknown-linux-gnu',
    arch: 'arm64',
    env: { CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER: 'aarch64-linux-gnu-gcc' },
  },
};

const desktopDir = join(import.meta.dirname, '..');
const repoRoot = join(desktopDir, '..', '..');
const binary = process.platform === 'win32' ? 'linkcode-pty.exe' : 'linkcode-pty';

function stage(arch: string, cross?: CrossBuild): void {
  const cargoArgs = ['build', '-p', 'linkcode-pty', '--release'];
  if (cross) cargoArgs.push('--target', cross.target);
  execFileSync('cargo', cargoArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...cross?.env },
  });
  const built = join(repoRoot, 'target', ...(cross ? [cross.target] : []), 'release', binary);
  const destDir = join(desktopDir, 'sidecar', arch);
  mkdirSync(destDir, { recursive: true });
  cpSync(built, join(destDir, binary));
  console.log(`staged ${built} -> ${join(destDir, binary)}`);
}

const { values } = parseArgs({ options: { all: { type: 'boolean' } } });
stage(process.arch);
if (values.all) {
  const cross = CROSS_BUILDS[process.platform];
  if (!cross) throw new Error(`no cross target configured for ${process.platform}`);
  stage(cross.arch, cross);
}
