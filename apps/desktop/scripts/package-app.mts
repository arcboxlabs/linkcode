#!/usr/bin/env node
/**
 * Package the desktop app from one materialized, single-importer staging directory per arch:
 * `node scripts/package-app.mts [mac|win|linux] [--x64|--arm64] [--devshell] [builder args]`.
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
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import type { AgentKind } from '@linkcode/schema';
import crossSpawn from 'cross-spawn';
import { agentFilesExcludes } from '../src/build/agent-package-excludes';
import { assertStagedConfigMatchesGenerated } from './package-config.mts';
import { mergeUpdateFeeds } from './update-feed.mts';

const HOST_PLATFORM: Partial<Record<NodeJS.Platform, BuilderPlatform>> = {
  darwin: 'mac',
  win32: 'win',
  linux: 'linux',
};
const BUILDER_PLATFORMS = ['mac', 'win', 'linux'] as const;
type BuilderPlatform = (typeof BUILDER_PLATFORMS)[number];
const BUILDER_ARCHES = ['x64', 'arm64'] as const;
type BuilderArch = (typeof BUILDER_ARCHES)[number];

const desktopDir = join(import.meta.dirname, '..');
const repoRoot = join(desktopDir, '..', '..');
const assetsDir = join(repoRoot, 'assets');
/** Kept where CI's upload + verify-artifacts.mts already look (electron-builder.yml directories.output). */
const releaseDir = join(desktopDir, 'release');
/**
 * OUTSIDE the workspace on purpose: a staging dir under the repo would be rediscovered as a
 * workspace member, reintroducing the multi-importer collection this flow exists to avoid.
 */
function stagingDir(arch: BuilderArch): string {
  return join(tmpdir(), `linkcode-desktop-staging-${arch}`);
}

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
const requestedArches = BUILDER_ARCHES.filter((arch) => args.includes(`--${arch}`));
// Everything the caller passed that isn't ours is forwarded to electron-builder (--publish, signing).
const passthrough = args.filter(
  (arg) =>
    arg !== '--devshell' &&
    !platformTokens.has(arg) &&
    !BUILDER_ARCHES.some((arch) => arg === `--${arch}`),
);

/** Deploy one arch's production closure, then sync the build outputs into it. */
function materializeStaging(arch: BuilderArch): string {
  const target = stagingDir(arch);
  rmSync(target, { recursive: true, force: true });
  // --legacy: deploy without pnpm's inject-workspace-packages requirement (v10+ default refusal).
  run(
    'pnpm',
    ['--filter', '@linkcode/desktop', '--prod', 'deploy', '--legacy', `--cpu=${arch}`, target],
    repoRoot,
  );
  // deploy's file selection skips .gitignore'd paths inconsistently across pnpm versions; sync the
  // build outputs in explicitly so `files: out/**` and `extraResources: sidecar/${arch}` resolve.
  for (const dir of ['out', 'sidecar']) {
    const dest = join(target, dir);
    rmSync(dest, { recursive: true, force: true });
    cpSync(join(desktopDir, dir), dest, { recursive: true });
  }
  return target;
}

/** Doc files that must survive the prune: license/attribution texts we redistribute. */
const KEEP_DOC = /^(?:licen[cs]e|notice|copying)/i;

const TS_SOURCE_RE = /\.[mc]?ts$/;
const MARKDOWN_RE = /\.(?:md|markdown)$/i;

/**
 * Drop build-time-only file classes from the staged node_modules before electron-builder collects
 * the asar (CODE-215): sourcemaps, TypeScript sources and declarations, and markdown docs — ~50 MB
 * of the deploy closure that Node never loads at runtime. Whole-package dead weight is excluded via
 * `files` globs in electron-builder.yml instead; notably better-sqlite3/deps must stay HERE in
 * staging because @electron/rebuild compiles from it before collection.
 */
function pruneStaging(target: string): void {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(join(target, 'node_modules'), {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const prunable =
      entry.name.endsWith('.map') ||
      TS_SOURCE_RE.test(entry.name) ||
      (MARKDOWN_RE.test(entry.name) && !KEEP_DOC.test(entry.name));
    if (!prunable) continue;
    const path = join(entry.parentPath, entry.name);
    bytes += statSync(path).size;
    files += 1;
    rmSync(path);
  }
  console.log(
    `pruned ${files} runtime-dead files (${Math.round(bytes / 1_048_576)} MB) from staging`,
  );
}

/**
 * Build only the arches whose PTY sidecar was staged: `extraResources: sidecar/${arch}` cannot
 * resolve an arch that wasn't (CI stages both via `stage-sidecar --all`; a local
 * `stage:host-runtime` stages just the host).
 */
function stagedArches(): BuilderArch[] {
  const stagedNames = new Set(readdirSync(join(desktopDir, 'sidecar')));
  const staged = BUILDER_ARCHES.filter((arch) => stagedNames.has(arch));
  if (staged.length === 0) throw new Error('no staged sidecar arch; run stage:host-runtime first');
  const arches = requestedArches.length === 0 ? staged : requestedArches;
  for (const arch of arches) {
    if (!staged.includes(arch)) throw new Error(`sidecar/${arch} is not staged`);
  }
  return arches;
}

function updateFeedName(arch: BuilderArch): string {
  if (platform === 'mac') return 'latest-mac.yml';
  if (platform === 'win') return 'latest.yml';
  return arch === 'arm64' ? 'latest-linux-arm64.yml' : 'latest-linux.yml';
}

/** Identity-owned builder fields; a passthrough `-c.` override of these on a branded build would
 * silently re-brand the artifact, so they are refused outright. */
const IDENTITY_OVERRIDE_RE = /^-c\.(?:appId|productName|protocols)\b/;

/** The rendered build bundle's declared agents, or `null` if absent/unrendered (CODE-618). */
function stagedAllowedAgents(): readonly AgentKind[] | null {
  const bundlePath = join(desktopDir, 'out', 'config', 'build-bundle.json');
  if (!existsSync(bundlePath)) return null;
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8')) as { agents?: unknown };
  return Array.isArray(bundle.agents) ? (bundle.agents as AgentKind[]) : null;
}

/**
 * Wraps `configPath` in a temporary `extends` overlay adding `excludes` to `files` — electron-
 * builder concatenates an extended config's `files` array rather than replacing it. `configPath`
 * is always absolute here, which `extends` also resolves as-is (only relative `extends` targets
 * resolve against the project dir — see electron-builder-brand.ts).
 */
function withFilesOverlay(configPath: string, excludes: readonly string[]): string {
  if (excludes.length === 0) return configPath;
  const overlayPath = join(tmpdir(), 'linkcode-desktop-agent-excludes.json');
  writeFileSync(overlayPath, JSON.stringify({ extends: configPath, files: excludes }));
  return overlayPath;
}

function build(): void {
  // Both extend the shared electron-builder.yml base; each adds its own deep-link scheme (release
  // `linkcode://`, dev shell `linkcode-dev://`). The base is never passed directly — it has none.
  const branded = assertStagedConfigMatchesGenerated(desktopDir);
  if (branded && devshell) {
    // out/ already embeds the branded bootstrap+identity; packing it as a dev shell would mix
    // the LinkCode Development shell identity with another brand's runtime identity.
    throw new Error(
      'apps/desktop/generated holds a rendered brand config; delete it (or package without ' +
        '--devshell) — a dev shell must not embed another brand',
    );
  }
  const brandConfig = join(desktopDir, 'out', 'config', 'electron-builder.brand.json');
  if (branded) {
    const rejected = passthrough.find((arg) => IDENTITY_OVERRIDE_RE.test(arg));
    if (rejected !== undefined) {
      throw new Error(`branded builds refuse identity overrides: ${rejected}`);
    }
  }
  const config = devshell
    ? 'electron-builder.devshell.yml'
    : branded
      ? brandConfig
      : 'electron-builder.release.yml';
  const configPath = branded ? config : join(desktopDir, config);
  // Restricted-brand SDK exclusion (CODE-618): absent bundle agents is a no-op, so an unbranded
  // (or unrestricted) build passes `configPath` through unmodified.
  const finalConfigPath = withFilesOverlay(configPath, agentFilesExcludes(stagedAllowedAgents()));
  const brandIcon = join(desktopDir, 'out', 'config', 'brand-assets', 'icon.png');
  const feeds = new Map<string, string>();
  for (const arch of stagedArches()) {
    const target = materializeStaging(arch);
    pruneStaging(target);
    const feedName = updateFeedName(arch);
    const feedPath = join(releaseDir, feedName);
    rmSync(feedPath, { force: true });
    run(
      'pnpm',
      [
        'exec',
        'electron-builder',
        `--${platform}`,
        `--${arch}`,
        '--projectDir',
        target,
        '--config',
        finalConfigPath,
        // projectDir is the staging dir, so config-relative paths would resolve under it; redirect
        // output back to where CI/verify-artifacts expect it and icons to the shared repo-root
        // assets — or, on branded builds, to the staged brand assets only.
        `-c.directories.output=${releaseDir}`,
        `-c.mac.icon=${branded ? brandIcon : join(assetsDir, 'linkcode.icon')}`,
        `-c.win.icon=${branded ? brandIcon : join(assetsDir, 'icon.png')}`,
        // A directory of per-size PNGs — app-builder-lib 26+ won't expand a single PNG into a size
        // set, so a lone raster installs only hicolor/1024x1024 (unindexed → GNOME fallback icon).
        // Branded builds ship the single brand raster for now (launcher may fall back on GNOME).
        `-c.linux.icon=${branded ? brandIcon : join(assetsDir, 'linux-icons')}`,
        ...(devshell ? ['--dir'] : []),
        ...passthrough,
      ],
      desktopDir,
    );
    if (existsSync(feedPath)) {
      const text = readFileSync(feedPath, 'utf8');
      const existing = feeds.get(feedName);
      feeds.set(feedName, existing === undefined ? text : mergeUpdateFeeds(existing, text));
    }
  }
  for (const [name, text] of feeds) writeFileSync(join(releaseDir, name), text);
}

build();
