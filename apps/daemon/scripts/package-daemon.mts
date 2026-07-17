#!/usr/bin/env node
/**
 * Package the daemon as a self-contained standalone dir (default apps/daemon/standalone; argv[2]
 * overrides for CI) via `pnpm --prod deploy`: the tsup bundle plus its runtime externals flat in
 * the dir's own node_modules, runnable as `node --import ./dist/instrument.js dist/index.js`.
 *
 *   pnpm -F @linkcode/daemon package         # -> apps/daemon/standalone
 *   node scripts/package-daemon.mts <outDir> # explicit destination (CI)
 *
 * `pnpm --prod deploy` materializes the daemon's production closure — the tsup bundle's runtime
 * externals (better-sqlite3 + its native binding, ws, socket.io, @sentry, the agent SDKs, the
 * @linkcode/assets fetch stack) flat in the dir's own node_modules — so the result runs as
 * `node --import ./dist/instrument.js dist/index.js` with nothing else on disk.
 *
 * Unlike the desktop bundle (Electron `utilityProcess`, native modules rebuilt to Electron's ABI),
 * this targets plain Node: better-sqlite3 keeps the prebuild-install binary for the build host's
 * Node/OS/arch. It is therefore a same-platform artifact — build it on (or for) each target.
 *
 * Agent CLI platform binaries are pruned: they are host-arch, ~230 MB each, and the daemon
 * provisions them at runtime through its managed-asset store (@linkcode/assets, CODE-111) exactly
 * as the desktop app does since CODE-114 — shipping them would only bloat the artifact.
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

/**
 * The pi npm closure is a managed download too (CODE-219): the daemon installs the whole tree
 * from the lockfile-generated manifest on first use. Exact scope/package dirs, pi-only in the
 * production closure (verified via `pnpm why --prod`, 2026-07-17); pi's nested @anthropic-ai/sdk
 * copy lives under @earendil-works/ and goes with it.
 */
const PRUNE_PI_CLOSURE = [
  '@earendil-works',
  '@mariozechner',
  '@mistralai',
  '@google/genai',
  '@aws-sdk',
  '@aws-crypto',
  '@smithy',
  'openai',
  'typebox',
  'web-streams-polyfill',
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

for (const pkg of PRUNE_PI_CLOSURE) {
  rmSync(join(outDir, 'node_modules', pkg), { recursive: true, force: true });
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
