/// <reference types="node" />
import { mkdirSync, mkdtempSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import type { ManagedAssetId } from '@linkcode/schema';
import { DATA_DIRNAME } from '@linkcode/schema/product';

/**
 * Store layout `<root>/<namespace>/<name>/<version>/…`: the id's `:` becomes a directory level
 * (Windows reserves it); `.tmp-*` install dirs are version-dir siblings so publish is one
 * same-volume atomic `rename`. Every path resolves at call time — never at module load — so
 * `LINKCODE_ASSETS_DIR` or a fake `$HOME` redirects the whole store.
 */

interface RootContext {
  platform: typeof process.platform;
  env: Record<string, string | undefined>;
  home: string;
}

/** Pure core of {@link assetsRoot}, parameterized for tests. */
export function assetsRootFor(ctx: RootContext): string {
  const override = ctx.env.LINKCODE_ASSETS_DIR;
  if (override) return override;
  switch (ctx.platform) {
    case 'darwin':
      return join(ctx.home, 'Library', 'Application Support', DATA_DIRNAME, 'assets');
    case 'win32':
      return join(
        ctx.env.LOCALAPPDATA ?? join(ctx.home, 'AppData', 'Local'),
        DATA_DIRNAME,
        'assets',
      );
    default:
      return join(
        ctx.env.XDG_DATA_HOME ?? join(ctx.home, '.local', 'share'),
        DATA_DIRNAME.toLowerCase(),
        'assets',
      );
  }
}

/** The per-user store root: `LINKCODE_ASSETS_DIR` wins, else the platform data directory. */
export function assetsRoot(): string {
  return assetsRootFor({ platform: process.platform, env: process.env, home: homedir() });
}

export function assetDir(id: ManagedAssetId): string {
  const [namespace, name] = id.split(':', 2);
  return join(assetsRoot(), namespace, name);
}

export function versionDir(id: ManagedAssetId, version: string): string {
  return join(assetDir(id), version);
}

/** Create a fresh transient install dir beside the asset's version dirs. */
export function makeTmpDir(id: ManagedAssetId): string {
  const dir = assetDir(id);
  mkdirSync(dir, { recursive: true });
  return mkdtempSync(join(dir, '.tmp-'));
}
