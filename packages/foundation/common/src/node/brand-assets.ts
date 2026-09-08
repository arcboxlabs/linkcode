/// <reference types="node" />
import { createHash } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/** Brand asset set v1 (publisher CONTRACT.md): a flat directory of regular files that must
 * contain icon.png. Mirrors the publisher-side checks — both ends fail closed independently. */
export const BRAND_ASSET_ICON = 'icon.png';

const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_ASSET_BYTES = 4 * 1024 * 1024;

export interface StagedBrandAsset {
  readonly name: string;
  readonly sha256: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function validatedAssetDir(structuralDir: string, assetsPath: string): string {
  const root = resolve(structuralDir);
  const dir = resolve(root, assetsPath);
  if (dir !== root && !dir.startsWith(root + sep)) {
    fail(`brand assets path ${assetsPath} escapes the structural checkout`);
  }
  let dirStats;
  try {
    dirStats = lstatSync(dir, { throwIfNoEntry: false });
  } catch {
    fail(`brand assets directory ${assetsPath} does not exist`);
  }
  if (dirStats === undefined) fail(`brand assets directory ${assetsPath} does not exist`);
  if (dirStats.isSymbolicLink()) fail(`brand assets directory ${assetsPath} must not be a symlink`);
  if (!dirStats.isDirectory()) fail(`brand assets path ${assetsPath} is not a directory`);
  return dir;
}

/**
 * Copies exactly the selected brand's asset set out of the structural checkout into an isolated
 * output directory, failing closed on anything a build could mis-ship: symlinks, nested
 * directories, empty/oversized files, a missing or non-PNG icon, or a path escaping the
 * checkout. The output directory is replaced wholesale so a previous brand's files can never
 * survive a re-render. Returns the staged files with content digests, sorted by name.
 */
export function stageBrandAssets(options: {
  readonly assetsPath: string;
  readonly outDir: string;
  readonly structuralDir: string;
}): readonly StagedBrandAsset[] {
  const dir = validatedAssetDir(options.structuralDir, options.assetsPath);
  const entries = readdirSync(dir).sort();
  const label = options.assetsPath;
  for (let i = 0, len = entries.length; i < len; i++) {
    const entry = entries[i];
    const stats = lstatSync(join(dir, entry));
    if (stats.isSymbolicLink()) fail(`brand asset ${label}/${entry} must not be a symlink`);
    if (!stats.isFile()) {
      fail(`brand asset ${label}/${entry} must be a regular file (asset set v1 is flat)`);
    }
    if (stats.size === 0 || stats.size > MAX_ASSET_BYTES) {
      fail(`brand asset ${label}/${entry} has an invalid size`);
    }
  }
  if (!entries.includes(BRAND_ASSET_ICON)) {
    fail(`brand assets directory ${label} is missing ${BRAND_ASSET_ICON}`);
  }
  const icon = readFileSync(join(dir, BRAND_ASSET_ICON));
  if (icon.length < PNG_MAGIC.length || !icon.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    fail(`brand asset ${label}/${BRAND_ASSET_ICON} is not a PNG file`);
  }

  const outDir = resolve(options.outDir);
  rmSync(outDir, { force: true, recursive: true });
  mkdirSync(outDir, { recursive: true });
  return entries.map((name) => {
    copyFileSync(join(dir, name), join(outDir, name));
    const sha256 = createHash('sha256')
      .update(readFileSync(join(outDir, name)))
      .digest('hex');
    return { name, sha256 };
  });
}
