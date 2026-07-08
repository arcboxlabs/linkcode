#!/usr/bin/env node
/**
 * Package the desktop app from a materialized, single-importer staging directory.
 *
 *   node scripts/package-app.mts [mac|win|linux] [--devshell] [-- <extra electron-builder args>]
 *
 * Why staging instead of packing apps/desktop in place: electron-builder resolves BOTH the native
 * rebuild root and the asar module collection from the workspace, and pnpm's hoisted layout puts
 * the app's runtime deps (better-sqlite3, js-yaml, …) in the repo-root node_modules, not under
 * apps/desktop. Two failures follow, and neither errors loudly:
 *
 *  - Native rebuild (@electron/rebuild) walks up from `appDir` to the detected workspace root
 *    looking for native modules. On Windows electron-builder detects that root by running
 *    `pnpm --workspace-root exec pwd` — there is no `pwd`, so it falls back to a package.json
 *    `workspaces` field (which pnpm workspaces do not have) and lands on apps/desktop. better-sqlite3
 *    is not there, so it is never rebuilt to Electron's ABI and the shipped .node keeps the
 *    plain-Node ABI — the daemon dies on `require('better-sqlite3')` and every client shows
 *    "Unable to connect to the daemon". (Windows shipped this from 0.1.0 through 0.2.1.)
 *  - The pnpm module collector enumerates every workspace importer, which both EMFILEs on Windows
 *    and lets pnpm's cross-importer dedup drop a uniquely-placed copy of a transitive dep out of
 *    the asar entirely (js-yaml → electron-updater crash on boot).
 *
 * `pnpm --prod deploy` materializes a self-contained dir with the app's production closure flat in
 * its own node_modules. Pointing electron-builder's `--projectDir` at it (OUTSIDE the workspace,
 * so no `pnpm --workspace-root` detection kicks in) makes appDir === projectDir === workspaceRoot:
 * the rebuild walker finds better-sqlite3 on step one regardless of platform, and the module
 * collector sees exactly one importer (pnpm reports it has no lockfile there and electron-builder
 * falls through to its filesystem-traversal collector). The app-builder-lib collector patch and
 * the .pnpmfile.cjs dedup workaround both exist only to paper over the multi-importer path and are
 * removed alongside this.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

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
 * OUTSIDE the workspace on purpose: a staging dir under the repo would be discovered as a workspace
 * member (or resolve `pnpm --workspace-root` back to the repo), reintroducing the multi-importer
 * collection this whole flow avoids.
 */
const stagingDir = join(tmpdir(), 'linkcode-desktop-staging');

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
  execFileSync(
    'pnpm',
    ['--filter', '@linkcode/desktop', '--prod', 'deploy', '--legacy', stagingDir],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  // deploy's file selection skips .gitignore'd paths inconsistently across pnpm versions; sync the
  // build outputs in explicitly so `files: out/**` and `extraResources: sidecar/${arch}` resolve.
  for (const dir of ['out', 'sidecar']) {
    const dest = join(stagingDir, dir);
    rmSync(dest, { recursive: true, force: true });
    cpSync(join(desktopDir, dir), dest, { recursive: true });
  }
}

function build(): void {
  const config = devshell ? 'electron-builder.devshell.yml' : 'electron-builder.yml';
  const builderArgs = [
    'exec',
    'electron-builder',
    `--${platform}`,
    '--projectDir',
    stagingDir,
    '--config',
    join(desktopDir, config),
    // projectDir is the staging dir, so config-relative paths (output, icons) would resolve under
    // it; redirect them back to the real tree. output stays where CI/verify-artifacts expect it,
    // icons point at the shared repo-root assets the committed config references as ../../assets.
    `-c.directories.output=${releaseDir}`,
    `-c.mac.icon=${join(assetsDir, 'linkcode.icon')}`,
    `-c.win.icon=${join(assetsDir, 'icon.png')}`,
    `-c.linux.icon=${join(assetsDir, 'icon.png')}`,
    ...(devshell ? ['--dir'] : []),
    ...passthrough,
  ];
  execFileSync('pnpm', builderArgs, { cwd: desktopDir, stdio: 'inherit' });
}

materializeStaging();
build();
