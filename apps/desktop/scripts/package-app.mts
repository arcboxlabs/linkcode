#!/usr/bin/env node
/**
 * Package the desktop app from a materialized, single-importer staging directory (CODE-107):
 * `node scripts/package-app.mts [mac|win|linux] [--devshell] [-- <extra electron-builder args>]`.
 *
 * Packing apps/desktop in place fails silently twice under pnpm's hoisted layout: on Windows the
 * @electron/rebuild workspace-root detection misses the repo root, so better-sqlite3 is never
 * rebuilt to Electron's ABI and the daemon dies on `require` — "Unable to connect to the daemon"
 * (shipped 0.1.0–0.2.1); and the pnpm module collector enumerates every workspace importer, which
 * EMFILEs on Windows and lets cross-importer dedup drop a transitive dep out of the asar
 * (js-yaml → electron-updater crash on boot).
 *
 * `pnpm --prod deploy` materializes the production closure flat, and `--projectDir` pointed there
 * (OUTSIDE the workspace) makes appDir === projectDir === workspaceRoot: the rebuild finds
 * better-sqlite3 and the collector sees exactly one importer. The .pnpmfile.cjs
 * drizzle-orm↔expo-sqlite sever stays — it keeps the expo tree out of this deploy closure.
 */
import { cpSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import crossSpawn from 'cross-spawn';

const HOST_PLATFORM: Partial<Record<NodeJS.Platform, BuilderPlatform>> = {
  darwin: 'mac',
  win32: 'win',
  linux: 'linux',
};
const BUILDER_PLATFORMS = ['mac', 'win', 'linux'] as const;
type BuilderPlatform = (typeof BUILDER_PLATFORMS)[number];

const desktopDir = join(import.meta.dirname, '..');
const repoRoot = join(desktopDir, '..', '..');
const assetsDir = join(repoRoot, 'assets');
/** Kept where CI's upload + verify-artifacts.mts already look (electron-builder.yml directories.output). */
const releaseDir = join(desktopDir, 'release');
/**
 * OUTSIDE the workspace on purpose: a staging dir under the repo would be rediscovered as a
 * workspace member, reintroducing the multi-importer collection this flow exists to avoid.
 */
const stagingDir = join(tmpdir(), 'linkcode-desktop-staging');

/**
 * Run a command, inheriting stdio, throwing on failure. cross-spawn is required on Windows: a bare
 * `execFileSync('pnpm', …)` is ENOENT and even a resolved `pnpm.cmd` is not directly spawnable.
 * `spawn.sync` reports failures on its result rather than throwing, so surface them here.
 */
function run(command: string, commandArgs: string[], cwd: string): void {
  const result = crossSpawn.sync(command, commandArgs, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status ?? `signal ${result.signal}`}`);
  }
}

const platformTokens = new Set<string>(BUILDER_PLATFORMS);
const args = process.argv.slice(2);
const devshell = args.includes('--devshell');
const platform =
  BUILDER_PLATFORMS.find((name) => args.includes(name)) ?? HOST_PLATFORM[process.platform];
if (!platform) throw new Error(`unsupported host platform ${process.platform}; pass mac|win|linux`);
// Everything the caller passed that isn't ours is forwarded to electron-builder (--publish, signing).
const passthrough = args.filter((arg) => arg !== '--devshell' && !platformTokens.has(arg));

/** Deploy the production closure into a fresh staging dir, then sync the build outputs into it. */
function materializeStaging(): void {
  rmSync(stagingDir, { recursive: true, force: true });
  // --legacy: deploy without pnpm's inject-workspace-packages requirement (v10+ default refusal).
  run(
    'pnpm',
    ['--filter', '@linkcode/desktop', '--prod', 'deploy', '--legacy', stagingDir],
    repoRoot,
  );
  // deploy's file selection skips .gitignore'd paths inconsistently across pnpm versions; sync the
  // build outputs in explicitly so `files: out/**` and `extraResources: sidecar/${arch}` resolve.
  for (const dir of ['out', 'sidecar']) {
    const dest = join(stagingDir, dir);
    rmSync(dest, { recursive: true, force: true });
    cpSync(join(desktopDir, dir), dest, { recursive: true });
  }
}

/**
 * Build only the arches whose PTY sidecar was staged: `extraResources: sidecar/${arch}` cannot
 * resolve an arch that wasn't (CI stages both via `stage-sidecar --all`; a local
 * `stage:host-runtime` stages just the host).
 */
const KNOWN_ARCHES = new Set(['x64', 'arm64']);

function stagedArches(): string[] {
  const arches = readdirSync(join(desktopDir, 'sidecar')).filter((name) => KNOWN_ARCHES.has(name));
  if (arches.length === 0) throw new Error('no staged sidecar arch; run stage:host-runtime first');
  return arches;
}

function build(): void {
  // Both extend the shared electron-builder.yml base; each adds its own deep-link scheme (release
  // `linkcode://`, dev shell `linkcode-dev://`). The base is never passed directly — it has none.
  const config = devshell ? 'electron-builder.devshell.yml' : 'electron-builder.release.yml';
  const builderArgs = [
    'exec',
    'electron-builder',
    `--${platform}`,
    ...stagedArches().map((arch) => `--${arch}`),
    '--projectDir',
    stagingDir,
    '--config',
    join(desktopDir, config),
    // projectDir is the staging dir, so config-relative paths would resolve under it; redirect
    // output back to where CI/verify-artifacts expect it and icons to the shared repo-root assets.
    `-c.directories.output=${releaseDir}`,
    `-c.mac.icon=${join(assetsDir, 'linkcode.icon')}`,
    `-c.win.icon=${join(assetsDir, 'icon.png')}`,
    // A directory of per-size PNGs — app-builder-lib 26+ won't expand a single PNG into a size set,
    // so a lone raster installs only hicolor/1024x1024 (unindexed → GNOME fallback icon).
    `-c.linux.icon=${join(assetsDir, 'linux-icons')}`,
    ...(devshell ? ['--dir'] : []),
    ...passthrough,
  ];
  run('pnpm', builderArgs, desktopDir);
}

materializeStaging();
build();
