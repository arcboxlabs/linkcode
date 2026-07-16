#!/usr/bin/env node
/**
 * Package the daemon as a self-contained standalone dir (default apps/daemon/standalone; argv[2]
 * overrides for CI) via `pnpm --prod deploy`: the tsup bundle plus its runtime externals flat in
 * the dir's own node_modules, runnable as `node --import ./dist/instrument.js dist/index.js`.
 *
 * Targets plain Node, not Electron: better-sqlite3 keeps the build host's prebuild, so this is a
 * same-platform artifact — build it on (or for) each target. Agent CLI platform binaries
 * (host-arch, ~230 MB each) are pruned; the daemon provisions them at runtime via the
 * managed-asset store (@linkcode/assets, CODE-111 / CODE-114).
 */
import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import crossSpawn from 'cross-spawn';

const daemonDir = join(import.meta.dirname, '..');
const repoRoot = join(daemonDir, '..', '..');
// resolve() keeps an absolute argument absolute (a CI `/tmp/daemon`), only anchoring a relative one.
const outDir = process.argv[2] ? resolve(process.argv[2]) : join(daemonDir, 'standalone');

/**
 * Host-arch agent CLI packages the standalone daemon downloads on demand instead of shipping.
 * Mirrors the desktop `files` exclusions (electron-builder.yml) / verify-artifacts prefixes: only
 * the platform-suffixed packages, never the JS entry packages the adapter imports.
 */
const PRUNE = [
  ['@anthropic-ai', 'claude-agent-sdk-'],
  ['@openai', 'codex-darwin-'],
  ['@openai', 'codex-linux-'],
  ['@openai', 'codex-win32-'],
] as const;

/** Run a command, inheriting stdio, throwing on failure — cross-spawn for a Windows-safe pnpm. */
function run(command: string, commandArgs: string[], cwd: string): void {
  const result = crossSpawn.sync(command, commandArgs, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status ?? `signal ${result.signal}`}`);
  }
}

rmSync(outDir, { recursive: true, force: true });
// --legacy: deploy without pnpm's inject-workspace-packages requirement (v10+ default refusal).
run('pnpm', ['--filter', '@linkcode/daemon', '--prod', 'deploy', '--legacy', outDir], repoRoot);

// deploy's file selection skips .gitignore'd paths inconsistently across pnpm versions; sync the
// tsup bundle in explicitly so the artifact always has an up-to-date dist/.
rmSync(join(outDir, 'dist'), { recursive: true, force: true });
cpSync(join(daemonDir, 'dist'), join(outDir, 'dist'), { recursive: true });

for (const [scope, prefix] of PRUNE) {
  const scopeDir = join(outDir, 'node_modules', scope);
  if (!existsSync(scopeDir)) continue;
  for (const entry of readdirSync(scopeDir)) {
    if (entry.startsWith(prefix)) rmSync(join(scopeDir, entry), { recursive: true, force: true });
  }
}

const bytes = dirSize(outDir);
console.log(`daemon packaged at ${outDir} (${Math.round(bytes / 1e6)} MB)`);

function dirSize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else if (entry.isFile()) total += statSync(full).size;
  }
  return total;
}
